import {
    Bindings,
    Buffer,
    BufferUsage,
    ComputePipeline,
  } from '@antv/g-device-api';
  import { createProgram, registerShaderModule } from '../utils';
  import { GPUParticleEffect } from './GPUParticleEffect';
  import { modulate } from '../../utils';
  
  export interface SpiralAOptions {
    timeSpeed: number;
    zWarpSize: number;
    objectSize: number;
    waveSize: number;
    exposure: number;
  }
  
  export class SpiralA extends GPUParticleEffect {
    private options: SpiralAOptions;
    private customUniformBuffer: Buffer;
    private mainImagePipeline: ComputePipeline;
    private mainImageBindings: Bindings;
  
    constructor(
      shaderCompilerPath: string,
      options: Partial<SpiralAOptions> = {},
    ) {
      super(shaderCompilerPath);
  
      this.options = {
        timeSpeed: 0.4,
        zWarpSize: 0.2,
        objectSize: 0.4,
        waveSize: 0.4,
        exposure: 0.3,
        ...options,
      };
    }
  
    registerShaderModule() {
      const { device, screen } = this;
  
      const custom = /* wgsl */ `
    #define_import_path custom
    
    struct Custom {
      TimeSpeed: f32,
      ZWarpSize: f32,
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

fn Rotate(axis: f32) -> mat2x2f {
    let angles = vec4f(0.0, -1.5708, 1.5708, 0.0);
    let cosAngles = cos(axis * PI + angles);
    return mat2x2f(
        vec2f(cosAngles.x, cosAngles.y),
        vec2f(cosAngles.z, cosAngles.w)
    );
}

fn map(u: vec3f) -> f32 {
    let t: f32 = time.elapsed * custom.TimeSpeed * 10.;
    var l: f32 = 5.;
    let w: f32 = custom.ZWarpSize * 100.;
    var s: f32 = custom.ObjectSize;
    var f: f32 = 1e20;
    var i: f32 = 0.;
    var y: f32;
    var z: f32;

    var uu = vec3f(u.x, -u.z, u.y);
    var tmp = vec2f(atan2(uu.x, uu.y), length(uu.xy));
    uu.x = tmp.x; uu.y = tmp.y;
    uu.x += t / 6.;

    var p: vec3f;
    for ( ; i < l; i += 1.) {
        p = uu;
        y = round(max(p.y - i, 0.) / l) * l + i;
        p.x = p.x * (y);
        p.x = p.x - (sqrt(y * t * t * 2.));
        p.x = p.x - (round(p.x / TWO_PI) * TWO_PI);
        p.y = p.y - (y);
        p.z = p.z + (sqrt(y / w) * w);
        z = cos(y * t / 50.) * 0.5 + 0.5;
        p.z = p.z + (z * 5. * custom.WaveSize);
        p = abs(p);
        f = min(f, max(p.x, max(p.y, p.z)) - s * z);
    }

    return f;
} 

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: vec3u) {
    let R = vec2f(textureDimensions(screen).xy);
    let U = vec2f(f32(id.x), f32(id.y));
    let mouseClick = mouse.click;
    let mousePos = vec2f(mouse.pos);

    let l: f32 = 50.;
    var i: f32 = 0.;
    var d: f32 = i;
    var s: f32;
    var r: f32;
    var m: vec2f;
    if (mouseClick > 0) { 
		    m = -(mousePos - R / 2.) / R.y;
	  } else { 
		    m = vec2f(0., 0.17); 
	  };

    let o = vec3f(0.0, -10.0, -120.0); 
    let u: vec3f = normalize(vec3f(U - R / 2., R.y));
    var c: vec3f = vec3f(0.);
    var p: vec3f;

    var v: mat2x2f = Rotate(m.y);
    var h: mat2x2f = Rotate(m.x);

    for ( ; i < l; i += 1.) {
        p = u * d + o;
        var pyz = p.yz;
        pyz = p.yz * (v);
        p.y = pyz.x;
        p.z = pyz.y;
        var pxz = p.xz;
        pxz = p.xz * (h);
        p.x = pxz.x;
        p.z = pxz.y;
        s = map(p);
        r = (cos(round(length(p.xz)) * (time.elapsed * 5.) / 50.) * 0.7 - 1.8) / 2.;
        c = c + (min(s, exp(-s / 0.07)) * (cos((r + 0.5 + 0.5) * TWO_PI + radians(vec3f(60., 0., -60.))) * 0.5 + 0.5) * (r + 2.4));
        if (s < 0.001 || d > 1000.) {		
            break;
        }
        d = d + (s * 0.7);
    }

    var col = vec4f(exp(log(c) / 2.2), 1.);
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
        viewOrSize: 6 * Float32Array.BYTES_PER_ELEMENT,
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
              options.timeSpeed,
              options.zWarpSize,
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
  
    update(options: Partial<SpiralAOptions>) {
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