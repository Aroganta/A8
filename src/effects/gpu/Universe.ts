import {
    Bindings,
    Buffer,
    BufferUsage,
    ComputePipeline,
  } from '@antv/g-device-api';
  import { createProgram, registerShaderModule } from '../utils';
  import { GPUParticleEffect } from './GPUParticleEffect';
  import { modulate } from '../../utils';
  
  export interface UniverseOptions {
    fft: number;
    exposure: number;
  }
  
  export class Universe extends GPUParticleEffect {
    private options: UniverseOptions;
    private customUniformBuffer: Buffer;
    private mainImagePipeline: ComputePipeline;
    private mainImageBindings: Bindings;
  
    constructor(
      shaderCompilerPath: string,
      options: Partial<UniverseOptions> = {},
    ) {
      super(shaderCompilerPath);
  
      this.options = {
        fft: 1.00,
        exposure: 0.30,
        ...options,
      };
    }
  
    registerShaderModule() {
      const { device, screen, $canvas } = this;
  
      const custom = /* wgsl */ `
    #define_import_path custom
    
    struct Custom {
      fft: f32,
      Exposure: f32,
    }
    
    @group(0) @binding(2) var<uniform> custom: Custom;
      `;
  
      registerShaderModule(device, custom);
  
      const computeWgsl = /* wgsl */ `
#import prelude::{screen, time, mouse};
#import math::{PI, TWO_PI};
#import custom::{Custom, custom};

fn N21(p: vec2<f32>) -> f32 {
    var a: vec3<f32> = fract(vec3<f32>(p.xyx) * vec3<f32>(213.897, 653.453, 253.098));
    a = a + (dot(a, a.yzx + 79.76));
    return fract((a.x + a.y) * a.z);
} 

fn GetPos(id: vec2<f32>, offs: vec2<f32>, t: f32) -> vec2<f32> {
    let n: f32 = N21(id + offs);
    let n1: f32 = fract(n * 10.);
    let n2: f32 = fract(n * 100.);
    let a: f32 = t + n;
    return offs + vec2<f32>(sin(a * n1), cos(a * n2)) * 0.4;
} 

fn GetT(ro: vec2<f32>, rd: vec2<f32>, p: vec2<f32>) -> f32 {
	  return dot(p - ro, rd);
} 

fn LineDist(a: vec3<f32>, b: vec3<f32>, p: vec3<f32>) -> f32 {
	  return length(cross(b - a, p - a)) / length(p - a);
} 

fn df_line(a: vec2<f32>, b: vec2<f32>, p: vec2<f32>) -> f32 {
    let pa: vec2<f32> = p - a;
    let ba: vec2<f32> = b - a;
    let h: f32 = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
    return length(pa - ba * h);
} 

fn line(a: vec2<f32>, b: vec2<f32>, uv: vec2<f32>) -> f32 {
    let r1: f32 = 0.04;
    let r2: f32 = 0.01;
    var d: f32 = df_line(a, b, uv);
    let d2: f32 = length(a - b);
    var fade: f32 = smoothstep(1.5, 0.5, d2);
    fade = fade + (smoothstep(0.05, 0.02, abs(d2 - 0.75)));
    return smoothstep(r1, r2, d) * fade;
} 

fn NetLayer(st: vec2<f32>, n: f32, t: f32) -> f32 {
    var st_var = st;
    let id: vec2<f32> = floor(st_var) + n;
    st_var = fract(st_var) - 0.5;
    var p: array<vec2<f32>,9>;
    var i: i32 = 0;

    for (var y: f32 = -1.; y <= 1.; y = y + 1) {
        for (var x: f32 = -1.; x <= 1.; x = x + 1) {
            p[i] = GetPos(id, vec2<f32>(x, y), t);
            i = i + 1;
        }

    }

    var m: f32 = 0.;
    var sparkle: f32 = 0.;

    for (var i: i32 = 0; i < 9; i = i + 1) {
        m = m + (line(p[4], p[i], st_var));
        let d: f32 = length(st_var - p[i]);
        var s: f32 = 0.005 / (d * d);
        s = s * (smoothstep(1., 0.7, d));
        var pulse: f32 = sin((fract(p[i].x) + fract(p[i].y) + t) * 5.) * 0.4 + 0.6;
        pulse = pow(pulse, 20.);
        s = s * (pulse);
        sparkle = sparkle + (s);
    }

    m = m + (line(p[1], p[3], st_var));
    m = m + (line(p[1], p[5], st_var));
    m = m + (line(p[7], p[5], st_var));
    m = m + (line(p[7], p[3], st_var));
    var sPhase: f32 = (sin(t + n) + sin(t * 0.1)) * 0.25 + 0.5;
    sPhase = sPhase + (pow(sin(t * 0.1) * 0.5 + 0.5, 50.) * 5.);
    m = m + (sparkle * sPhase);
    return m;
} 

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) invocation_id: vec3<u32>) {
    let screen_size = textureDimensions(screen);
    let R = vec2<f32>(f32(screen_size.x), f32(screen_size.y));
    let y_inverted_location = vec2<i32>(i32(invocation_id.x), i32(R.y) - i32(invocation_id.y));
    let location = vec2<i32>(i32(invocation_id.x), i32(invocation_id.y));
	  let mouseClick = mouse.click;
    let mousePos = vec2<f32>(f32(mouse.pos.x), -1. * f32(mouse.pos.y));
    
    var fragColor: vec4<f32>;
    var fragCoord = vec2<f32>(f32(location.x), R.y - f32(location.y));

    var uv: vec2<f32> = (fragCoord - R.xy * 0.5) / R.y;
    var M: vec2<f32> = mousePos.xy / R.xy - 0.5;
    var t: f32 = time.elapsed * 0.1;
    let s: f32 = sin(t);
    let c: f32 = cos(t);
    let rot: mat2x2<f32> = mat2x2<f32>(c, -s, s, c);
    let st: vec2<f32> = uv * rot;
    M = M * (rot * 2.);
    var m: f32 = 0.;

    for (var i: f32 = 0.; i < 1.; i = i + (1. / 4.)) {
        let z: f32 = fract(t + i);
        let size: f32 = mix(15., 1., z);
        let fade: f32 = smoothstep(0., 0.6, z) * smoothstep(1., 0.8, z);
        m = m + (fade * NetLayer(st * size - M * z, i, time.elapsed));
    }

    let glow: f32 = -uv.y * custom.fft * 2.;
    let baseCol: vec3<f32> = vec3<f32>(s, cos(t * 0.4), -sin(t * 0.24)) * 0.4 + 0.6;
    var col: vec3<f32> = baseCol * m;
    col = col + (baseCol * glow);
    col = col * (1. - dot(uv, uv));
    t = ((time.elapsed) % (230.));
    col = col * (smoothstep(0., 20., t) * smoothstep(224., 200., t));
    fragColor = vec4<f32>(col, 1.);
    let exposed = 1.0 - exp(-5.0 * custom.Exposure * fragColor.xyz / fragColor.w);
	  textureStore(screen, invocation_id.xy, float4(exposed, 1.));
} 
      `;
      
      const mainImageProgram = createProgram(device, {
        compute: {
          entryPoint: 'main_image',
          wgsl: computeWgsl,
          },
      });

      const customUniformBuffer = device.createBuffer({
        viewOrSize: 2 * Float32Array.BYTES_PER_ELEMENT,
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
            modulate(overallAvg, 0, 256, 0, 1) * options.fft,
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
  
    update(options: Partial<UniverseOptions>) {
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