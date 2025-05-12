// TODO
import {
  Bindings,
  Buffer,
  BufferUsage,
  ComputePipeline,
} from '@antv/g-device-api';
import { createProgram, registerShaderModule } from '../utils';
import { GPUParticleEffect } from './GPUParticleEffect';
import { modulate } from '../../utils';

export interface BifurcationOptions {
  radius: number;
  samples: number;
  accumulation: number;
  noiseAnimation: number;
  exposure: number;
  beta: number;
  alpha: number;
  betaAnim: number;
  betaS: number;
  gamma: number;
  epsilon: number;
  betaA: number;
  betaB: number;
}

export class Bifurcation extends GPUParticleEffect {
  private options: BifurcationOptions;
  private customUniformBuffer: Buffer;
  private clearPipeline: ComputePipeline;
  private clearBindings: Bindings;
  private rasterizePipeline: ComputePipeline;
  private rasterizeBindings: Bindings;
  private mainImagePipeline: ComputePipeline;
  private mainImageBindings: Bindings;

  constructor(
    shaderCompilerPath: string,
    options: Partial<BifurcationOptions> = {},
  ) {
    super(shaderCompilerPath);

    this.options = {
      radius: 0.306,
      samples: 0.226,
      accumulation: 0.890,
      noiseAnimation: 1,
      exposure: 0.238,
      beta: 0.425,
      alpha: 0.301,
      betaAnim: 0.019,
      betaS: 0.430,
      gamma: 1,
      epsilon: 0.224,
      betaA: 0.325,
      betaB: 0.301,
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
    Beta: f32,
    Alpha: f32,
    BetaAnim: f32,
    BetaS: f32,
    Gamma: f32,
    Epsilon: f32,
    BetaA: f32,
    BetaB: f32,
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
const FOV = 0.7;

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
    camera.pos = - (camera.cam*float3(8.0*custom.Radius+0.5,0.0,-.5));
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

fn bifurcation(iters: i32) {
    var p = rand4() * float4(4.0, 4.0, 5.0, 0.0) - float4(2.0, 2.0, -0.25, -1.25);
    let s = rand4().x;

    let alpha = custom.Alpha;
    let beta = custom.Beta + custom.BetaS*s;
    let gamma = custom.Gamma - 0.5*custom.BetaS*s;
    let epsilon = custom.Epsilon+ custom.BetaAnim*(0.5 * sin(time.elapsed) + 0.5);
    let beta2 = custom.BetaA;
    let beta3 = custom.BetaB;

    for (var j: i32 = 0; j <= iters; j = j + 1) {
        let p0 = p;
        p.x = p.w - p0.y*(beta * p0.x + (1.0 - beta) * p0.y + p0.z*(1.0 - epsilon)) + p.z*(gamma * p0.x + (1.0 - gamma) * p0.y + p0.z*epsilon);
        p.y = p0.x + p0.x * p0.y * alpha + p.z*beta2;
        p.z = p0.y - p0.z * p0.y * alpha * beta3 - p.x*0.1;

        if(j < iters - int(custom.Samples*MaxSamples + 1.0)) {continue;}
        var color = spectral_zucconi(350 + 350.0*s);
        color = pow(color, vec3(1.0));
        RasterizePoint(p.xyz, 32.0*color/(custom.Samples*MaxSamples + 1.0));
    }
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
    state = uint4(id.x, id.y, id.z, uint(custom.NoiseAnimation)*time.frame);

    bifurcation(int(MaxSamples*2.0));
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

    let exposed = 1.0 - exp(-5.0*custom.Exposure*color.xyz/color.w);

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
        viewOrSize: 13 * Float32Array.BYTES_PER_ELEMENT,
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
            (modulate(lowerAvgFr, 0, 1, 0.5, 4) / 4) * options.beta,
            options.alpha,
            options.betaAnim,
            options.betaS,
            options.gamma,
            options.epsilon,
            (modulate(upperAvgFr, 0, 1, 0.5, 4) / 4) * options.betaA,
            options.betaB,
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

  update(options: Partial<BifurcationOptions>) {
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