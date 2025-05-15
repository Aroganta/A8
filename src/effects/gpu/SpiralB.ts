import {
    Bindings,
    Buffer,
    BufferUsage,
    ComputePipeline,
  } from '@antv/g-device-api';
  import { createProgram, registerShaderModule } from '../utils';
  import { GPUParticleEffect } from './GPUParticleEffect';
  import { modulate } from '../../utils';
  
  export interface SpiralBOptions {
    speed: number;
    objectSize: number;
    waveSize: number;
    exposure: number;
  }
  
  export class SpiralB extends GPUParticleEffect {
    private options: SpiralBOptions;
    private customUniformBuffer: Buffer;
    private mainImagePipeline: ComputePipeline;
    private mainImageBindings: Bindings;
  
    constructor(
      shaderCompilerPath: string,
      options: Partial<SpiralBOptions> = {},
    ) {
      super(shaderCompilerPath);
  
      this.options = {
        speed: 0.500,
        objectSize: 0.700,
        waveSize: 0.500,
        exposure: 0.200,
        ...options,
      };
    }
  
    registerShaderModule() {
      const { device, screen } = this;
  
      const custom = /* wgsl */ `
    #define_import_path custom
    
    struct Custom {
      Speed: f32,
      ObjectSize: f32,
      WaveSize: f32,
      Exposure: f32,
    }
    
    @group(0) @binding(2) var<uniform> custom: Custom;
      `;
  
      registerShaderModule(device, custom);
  
      const computeWgsl = /* wgsl */ `
#import prelude::{screen, time, mouse};
#import math::{PI, TWO_PI};
#import custom::{Custom, custom};

fn rotate(axis: f32) -> mat2x2f {
    let angles = vec4f(0.0, 1.5708, -1.5708, 0.0);
    let cosAngles = cos(axis * PI - angles);
    return mat2x2f(
        vec2f(cosAngles.x, cosAngles.y),
        vec2f(cosAngles.z, cosAngles.w)
    );
}

fn Q(u: vec3f) -> f32 {
    let t: f32 = time.elapsed / 200.;
    let l: f32 = 5.;
    var s: f32 = custom.ObjectSize * 0.6;
    let a: f32 = custom.WaveSize * 6.;
    let r: f32 = dot(u.xy, u.xy);
    var f: f32 = 1e20;
    var i: f32 = 0.;
    var y: f32;
    var z: f32;

    var uxy = u.xy;
    uxy = vec2f(atan2(u.x, u.y), length(u.xy));
    uxy.x = uxy.x + (t * 133. * custom.Speed * 2);

    for ( ; i < l; i += 1.) {
        var p: vec3f = vec3f(uxy.x, uxy.y, u.z);
        y = round((p.y - i) / l) * l + i;
        p.x = p.x * (y);
        p.x = p.x - (y * y * t * PI);
        p.x = p.x - (round(p.x / TWO_PI) * TWO_PI);
        p.y = p.y - (y);
        z = cos(y * t * TWO_PI) * 0.5 + 0.5;
        p.z = p.z + (z * a);
        p.z = p.z + (r * 0.00005);
        f = min(f, length(p) - s * z);
    }

    return f;
} 

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: vec3u) {
    let R = vec2f(textureDimensions(screen).xy);
    let U = vec2f(f32(id.x), R.y - f32(id.y));
    let mouseClick = mouse.click;
    let mousePos = vec2f(mouse.pos);

	  var m = cos(time.elapsed / 4. - vec2f(0, 1.5708)) * 0.3;
	  if (mouseClick > 0) {
		    m = (mousePos - R / 2.) / R.y;
	  }
    var o: vec3f = vec3f(0., -10. * sqrt(1. - abs(m.y * 2.)), -90. / (m.y + 1.));
    let u: vec3f = normalize(vec3f(U - R / 2., R.y));
    var c: vec3f = o.xxx;
    var p: vec3f;
    let h: mat2x2f = rotate(m.x / 2.);
    let v: mat2x2f = rotate((m.y+.5)/2.);
    var i: f32 = 0.;
    var d: f32 = i;
    var s: f32;
    var g: f32;

	  for ( ; i < 70.; i += 1.) {
		    p = u * d + o;
		    var pxz = p.xz;
        pxz = p.xz * (h);
        p.x = pxz.x;
        p.z = pxz.y;
		    var pyz = p.yz;
        pyz = p.yz * (v);
        p.y = pyz.x;
        p.z = pyz.y;
        s = Q(p);
        g = cos(round(length(p.xy)) * (time.elapsed / 200.) * TWO_PI) * 0.5 + 0.5;
        c = c + (min(s, exp(-s / 0.05)) * (g + 0.1) * (cos((0.1 - g / 2. + 0.5) * TWO_PI + vec3f(0., 1., 2.)) * 0.5 + 0.5) * 8.);
        if (s < 0.001 || d > 1000.) {		
            break;
        }
		    d = d + (s * 0.7);
	  }

	  var col = vec4f(exp(log(c) / 1.2 ), 1.);
    let exposed = 1.0 - exp(-5.0 * custom.Exposure * col.xyz / col.w);
    textureStore(screen, id.xy, float4(exposed, 1.));
} 

      `;
      
      const mainImageProgram = createProgram(device, {
        compute: {
          entryPoint: 'main_image',
          wgsl: computeWgsl,
          },
      });

      const customUniformBuffer = device.createBuffer({
        viewOrSize: 4 * Float32Array.BYTES_PER_ELEMENT,
        usage: BufferUsage.UNIFORM,
      });

      const mainImagePipeline = device.createComputePipeline({
        inputLayout: null,
        program: mainImageProgram,
      });

      const mainImageBindings = device.createBindings({
        pipeline: mainImagePipeline,
        uniformBufferBindings: [
          {
            buffer: this.timeBuffer,
          },
          {
            buffer: this.mouseBuffer,
          },
          {
            binding: 2,
            buffer: customUniformBuffer,
          },
        ],
        storageTextureBindings: [
          {
            texture: screen,
          },
        ],
      });
      this.customUniformBuffer = customUniformBuffer;
      this.mainImagePipeline = mainImagePipeline;
      this.mainImageBindings = mainImageBindings;
    }
  
    compute({ overallAvg, upperAvgFr, lowerAvgFr, classifyOutput }) {
      const {
        options,
        customUniformBuffer,
        device,
        $canvas,
        mainImagePipeline,
        mainImageBindings,
      } = this;
      customUniformBuffer.setSubData(
        0,
        new Uint8Array(
          new Float32Array([
              options.speed,
              options.objectSize,
              modulate(overallAvg, 0, 256, 0, 4) * options.waveSize,
              options.exposure + classifyOutput / 10.0,
          ]).buffer,
        ),
      );
  
      const x = Math.ceil($canvas.width / 16);
      const y = Math.ceil($canvas.height / 16);
  
      const computePass = device.createComputePass();
      computePass.setPipeline(mainImagePipeline);
      computePass.setBindings(mainImageBindings);
      computePass.dispatchWorkgroups(x, y);

      device.submitPass(computePass);
    }
  
    update(options: Partial<SpiralBOptions>) {
      this.options = {
        ...this.options,
        ...options,
      };
    }
  
    destroy(): void {
      this.customUniformBuffer.destroy();
      this.mainImagePipeline.destroy();

      super.destroy();
    }
  } 