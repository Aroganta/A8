import {
  Bindings,
  Buffer,
  BufferUsage,
  ComputePipeline,
} from '@antv/g-device-api';
import { createProgram, registerShaderModule } from '../utils';
import { GPUParticleEffect } from './GPUParticleEffect';
import { modulate } from '../../utils';

export interface PlasmaCoilOptions {
  radius: number;
  samples: number;
  accumulation: number;
  noiseAnimation: number;
  exposure: number;
  pa: number;
  pb: number;
  pc: number;
  pd: number;
  pe: number;
  pf: number;
  dt: number;
}

export class PlasmaCoil extends GPUParticleEffect {
  private options: PlasmaCoilOptions;
  private customUniformBuffer: Buffer;
  private clearPipeline: ComputePipeline;
  private clearBindings: Bindings;
  private rasterizePipeline: ComputePipeline;
  private rasterizeBindings: Bindings;
  private mainImagePipeline: ComputePipeline;
  private mainImageBindings: Bindings;

  constructor(
    shaderCompilerPath: string,
    options: Partial<PlasmaCoilOptions> = {},
  ) {
    super(shaderCompilerPath);

    this.options = {
      radius: 0.207,
      samples: 2.198,
      accumulation: 0.791,
      noiseAnimation: 1,
      exposure: 1.532,
      pa: 0,
      pb: 0.55,
      pc: 0.1,
      pd: 4.718,
      pe: 0.761,
      pf: 0.945,
      dt: 0.170,
      ...options,
    };
  }

  registerShaderModule() {
    const { device, screen, $canvas } = this;

    const custom = /* wgsl */ `
#define_import_path custom

struct Custom {
  Radius: f32,
  Samples: f32,
  Accumulation: f32,
  NoiseAnimation: f32,
  Exposure: f32,
  Pa: f32,
  Pb: f32,
  Pc: f32,
  Pd: f32,
  Pe: f32,
  Pf: f32,
  DT: f32,
}

@group(0) @binding(2) var<uniform> custom: Custom;
      `;

    registerShaderModule(device, custom);

    const computeWgsl = /* wgsl */ `
#import prelude::{screen, time, mouse};
#import math::{PI, TWO_PI, rand4, nrand4, udir, disk, Rotate, RotXY, state};
#import camera::{Camera, camera, GetCameraMatrix, Project};
#import custom::{Custom, custom};
  
@group(2) @binding(0) var<storage, read_write> atomic_storage : array<atomic<i32>>;
  
const MaxSamples = 256.0;
const FOV = 0.6;
const STEP = 0.01;
const LARGENUM = 1e10;
const ATOMIC_SCALE = 1024.0;
  
  
fn SetCamera()
{
    let screen_size = int2(textureDimensions(screen));
    let screen_size_f = float2(screen_size);
    let ang = float2(mouse.pos.xy)*float2(-TWO_PI, PI)/screen_size_f + float2(0.4, 0.4);

    camera.fov = FOV;
    camera.cam = GetCameraMatrix(ang); 
    camera.pos = - (camera.cam*float3(8.0*custom.Radius+0.5,0.0,0.0));
    camera.size = screen_size_f;
}
    
fn AdditiveBlend(color: float3, depth: float, index: int)
{
    let scaledColor = int3(floor(ATOMIC_SCALE*color/(depth*depth + 0.2) + rand4().xyz));

    if(scaledColor.x>0)
    {
        atomicAdd(&atomic_storage[index*4+0], scaledColor.x);
    }
       
    if(scaledColor.y>0)
    {
        atomicAdd(&atomic_storage[index*4+1], scaledColor.y);
    }

    if(scaledColor.z>0)
    {
        atomicAdd(&atomic_storage[index*4+2], scaledColor.z);
    }
}

fn RasterizePoint(pos: float3, color: float3)
{
    let screen_size = int2(camera.size);
    let projectedPos = Project(camera, pos);
    let screenCoord = int2(projectedPos.xy+0.5*rand4().xy);

    //outside of our view
    if(screenCoord.x < 0 || screenCoord.x >= screen_size.x || 
        screenCoord.y < 0 || screenCoord.y >= screen_size.y || projectedPos.z < 0.0)
    {
        return;
    }

    let idx = screenCoord.x + screen_size.x * screenCoord.y;
    AdditiveBlend(color, projectedPos.z, idx);
}


fn saturate(x: f32) -> f32 {
    return min(1.0, max(0.0, x));
}

fn saturate_vec3(x: vec3<f32>) -> vec3<f32> {
    return min(vec3<f32>(1.0, 1.0, 1.0), max(vec3<f32>(0.0, 0.0, 0.0), x));
}

fn bump3y(x: vec3<f32>, yoffset: vec3<f32>) -> vec3<f32> {
    var y: vec3<f32> = vec3<f32>(1.0, 1.0, 1.0) - x * x;
    y = saturate_vec3(y - yoffset);
    return y;
}

fn spectral_zucconi(w: f32) -> vec3<f32> {
    let x: f32 = saturate((w - 400.0) / 300.0);

    let cs: vec3<f32> = vec3<f32>(3.54541723, 2.86670055, 2.29421995);
    let xs: vec3<f32> = vec3<f32>(0.69548916, 0.49416934, 0.28269708);
    let ys: vec3<f32> = vec3<f32>(0.02320775, 0.15936245, 0.53520021);

    return bump3y(cs * (x - xs), ys);
}

fn hue(v: float) -> float3 {
    return .6 + .6 * cos(6.3 * v + float3(0.,23.,21.));
}
 
fn rot(v: float) -> float2 {
    return float2(cos(v), sin(v));
}

fn force(v: float3, t: float) -> float3 {
    let sc = custom.Pc*(rot(3.215*time.elapsed)+0.15*rot(15.515*time.elapsed).yx);
    let sc2 = 7.0*rot(2.0*time.elapsed) + 5.0*rot(0.25*3.14519*2.0*time.elapsed);
    let sc3 = 5.0*rot(1.3547*time.elapsed) + 5.0*rot(2.7547*time.elapsed);
    let sc4 = custom.Pd*rot(0.4*time.elapsed + t);
    var f = sin(custom.Pb*vec3(sc3.x + 1.0-t, sc2.x + sc3.y + 2.0+t, sc2.y + 3.0+2.0*t) * v);
    f += custom.Pe*sin(vec3(3.0,sc4.x,sc4.y)*(v + vec3(-0.4, 0.7,0.1)+ 0.02*f));
    f = -sc.x*sin(8.0*vec3(1.5, 2.0, 1.6) * f.zxy) - 0.3*sin(3.0*vec3(1.5, 2.0, 1.6) * f.yzx);
    f += sc.y*sin(8.0*vec3(1.5, 2.0, 1.6) * f.yzx);
    f += sc.x*sin(8.0*vec3(1.5, 2.0, 1.6) * f.yzx);
    f -= sc.y*sin(8.0*vec3(0.5, 0.2, 2.6) * f.yzx);
   
    
    return f; 
}

fn point_gen() {
    var r4 = rand4();

    let p0 = vec3(-1.0, 0.0, 0.0);
    let p1 = vec3(1.0, 0.0, 0.0);

    var p = mix(p0, p1, r4.x);
    let center = r4.x*(1.0-r4.x);
    let sc = custom.Pe*rot(0.5*time.elapsed);
    let delta = 0.25*vec3(0.1+sc.x,0.2,0.4+sc.y)*sin(50.0*vec3(1.1+sc.y,1.0,1.3)*r4.x) - 2.0*vec3(0.0,1.0,0.0);
    p += 2.0*center * delta;
    p += vec3(0.0,0.75,0.0);

    let t = 2.0*r4.y - 1.0;
    var color = mix(vec3(1.0,0.4,0.1), vec3(0.10, 0.40, 1.0), r4.y);
    //color = mix(color, vec3(0.0, 2.0, 0.05), 2.0*r4.y*(1.0 - r4.y));
    color *= mix(1.0 - t*t, t*t, custom.Pf);
    let dt = custom.DT;
    for(var i = 0; i < 16; i++)
    {
        let time = float(i)*t*dt;
        p += dt*force(p, time) * t * center;
    }

    RasterizePoint(p.xyz, 32.0*color);
}

@compute @workgroup_size(16, 16)
fn Clear(@builtin(global_invocation_id) id: uint3) {
    let screen_size = int2(textureDimensions(screen));
    let idx0 = int(id.x) + int(screen_size.x * int(id.y));

    atomicStore(&atomic_storage[idx0*4+0], 0);
    atomicStore(&atomic_storage[idx0*4+1], 0);
    atomicStore(&atomic_storage[idx0*4+2], 0);
    atomicStore(&atomic_storage[idx0*4+3], 0);
}

@compute @workgroup_size(16, 16)
fn Rasterize(@builtin(global_invocation_id) id: uint3) 
{
    SetCamera();

    //RNG state
    state = uint4(id.x, id.y, id.z, uint(custom.NoiseAnimation) * time.frame);

    let max_iters = int(custom.Samples);
    for(var i = 0; i < max_iters; i++)
    {
        point_gen();
    }
}

fn Sample(pos: int2) -> float3
{
    let screen_size = int2(textureDimensions(screen));
    let idx = pos.x + screen_size.x * pos.y;

    var color: float3;

    let x = float(atomicLoad(&atomic_storage[idx*4+0]));
    let y = float(atomicLoad(&atomic_storage[idx*4+1]));
    let z = float(atomicLoad(&atomic_storage[idx*4+2]));
    
    color = float3(x,y,z)/ATOMIC_SCALE;

    return abs(color);
}

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: uint3) 
{
    let screen_size = uint2(textureDimensions(screen));

    // Prevent overdraw for workgroups on the edge of the viewport
    if (id.x >= screen_size.x || id.y >= screen_size.y) { return; }

    // Pixel coordinates (centre of pixel, origin at bottom left)
    let fragCoord = float2(float(id.x) + .5, float(id.y) + .5);

    var color = float4(Sample(int2(id.xy)), 1.0);

    let exposed = 0.1*custom.Exposure*color.xyz/(color.w*custom.Samples);
    
    textureStore(screen, int2(id.xy), float4(exposed, 1.));
}
      `;
    const clearProgram = createProgram(device, {
      compute: {
        entryPoint: 'Clear',
        wgsl: computeWgsl,
      },
    });
    const rasterizeProgram = createProgram(device, {
      compute: {
        entryPoint: 'Rasterize',
        wgsl: computeWgsl,
      },
    });
    const mainImageProgram = createProgram(device, {
      compute: {
        entryPoint: 'main_image',
        wgsl: computeWgsl,
      },
    });

    const customUniformBuffer = device.createBuffer({
      viewOrSize: 12 * Float32Array.BYTES_PER_ELEMENT,
      usage: BufferUsage.UNIFORM,
    });

    const storageBuffer = device.createBuffer({
      viewOrSize:
        $canvas.width * $canvas.height * 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: BufferUsage.STORAGE,
    });

    const clearPipeline = device.createComputePipeline({
      inputLayout: null,
      program: clearProgram,
    });
    const rasterizePipeline = device.createComputePipeline({
      inputLayout: null,
      program: rasterizeProgram,
    });
    const mainImagePipeline = device.createComputePipeline({
      inputLayout: null,
      program: mainImageProgram,
    });

    const clearBindings = device.createBindings({
      pipeline: clearPipeline,
      storageBufferBindings: [
        {
          buffer: storageBuffer,
        },
      ],
      storageTextureBindings: [
        {
          texture: screen,
        },
      ],
    });
    const rasterizeBindings = device.createBindings({
      pipeline: rasterizePipeline,
      uniformBufferBindings: [
        {
          buffer: this.timeBuffer,
        },
        {
          buffer: this.mouseBuffer,
        },
        {
          buffer: customUniformBuffer,
        },
      ],
      storageBufferBindings: [
        {
          buffer: storageBuffer,
        },
      ],
      storageTextureBindings: [
        {
          texture: screen,
        },
      ],
    });
    const mainImageBindings = device.createBindings({
      pipeline: mainImagePipeline,
      uniformBufferBindings: [
        {
          binding: 2,
          buffer: customUniformBuffer,
        },
      ],
      storageBufferBindings: [
        {
          buffer: storageBuffer,
        },
      ],
      storageTextureBindings: [
        {
          texture: screen,
        },
      ],
    });
    this.customUniformBuffer = customUniformBuffer;
    this.clearPipeline = clearPipeline;
    this.clearBindings = clearBindings;
    this.rasterizePipeline = rasterizePipeline;
    this.rasterizeBindings = rasterizeBindings;
    this.mainImagePipeline = mainImagePipeline;
    this.mainImageBindings = mainImageBindings;
  }

  compute({ overallAvg, upperAvgFr, lowerAvgFr, classifyOutput }) {
    const {
      options,
      customUniformBuffer,
      device,
      $canvas,
      clearPipeline,
      clearBindings,
      rasterizePipeline,
      rasterizeBindings,
      mainImagePipeline,
      mainImageBindings,
    } = this;
    customUniformBuffer.setSubData(
      0,
      new Uint8Array(
        new Float32Array([
          options.radius + modulate(overallAvg, 0, 256, 0, 0.8),
          options.samples,
          options.accumulation,
          options.noiseAnimation,
          options.exposure + classifyOutput / 10.0,
          options.pa,
          options.pb,
          (modulate(lowerAvgFr, 0, 1, 0.5, 4) / 4) * options.pc,
          (modulate(upperAvgFr, 0, 1, 0.5, 4) / 4) * options.pd,
          options.pe,
          options.pf,
          options.dt,
        ]).buffer,
      ),
    );

    const x = Math.ceil($canvas.width / 16);
    const y = Math.ceil($canvas.height / 16);

    const computePass = device.createComputePass();
    computePass.setPipeline(clearPipeline);
    computePass.setBindings(clearBindings);
    computePass.dispatchWorkgroups(x, y);

    computePass.setPipeline(rasterizePipeline);
    computePass.setBindings(rasterizeBindings);
    computePass.dispatchWorkgroups(x, y);

    computePass.setPipeline(mainImagePipeline);
    computePass.setBindings(mainImageBindings);
    computePass.dispatchWorkgroups(x, y);
    device.submitPass(computePass);
  }

  update(options: Partial<PlasmaCoilOptions>) {
    this.options = {
      ...this.options,
      ...options,
    };
  }

  destroy(): void {
    this.customUniformBuffer.destroy();
    this.clearPipeline.destroy();
    this.rasterizePipeline.destroy();
    this.mainImagePipeline.destroy();

    super.destroy();
  }
} 