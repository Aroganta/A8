import {
  Bindings,
  Buffer,
  BufferUsage,
  ComputePipeline,
} from '@antv/g-device-api';
import { createProgram, registerShaderModule } from '../utils';
import { GPUParticleEffect } from './GPUParticleEffect';
import { modulate } from '../../utils';

export interface GalaxyOptions {
  radius: number;
  samples: number;
  noiseAnimation: number;
  bulbPower: number;
  exposure: number;
  powerDelta: number;
  gamma: number;
  animationSpeed: number;
}

export class Galaxy extends GPUParticleEffect {
  private options: GalaxyOptions;
  private customUniformBuffer: Buffer;
  private clearPipeline: ComputePipeline;
  private clearBindings: Bindings;
  private rasterizePipeline: ComputePipeline;
  private rasterizeBindings: Bindings;
  private mainImagePipeline: ComputePipeline;
  private mainImageBindings: Bindings;

  constructor(
    shaderCompilerPath: string,
    options: Partial<GalaxyOptions> = {},
  ) {
    super(shaderCompilerPath);

    this.options = {
      radius: 0.45,
      samples: 0,
      noiseAnimation: 0.627,
      bulbPower: 0.503,
      exposure: 0.182,
      powerDelta: 0.9,
      gamma: 0.9,
      animationSpeed: 1,
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
  NoiseAnimation: f32,
  BulbPower: f32,
  Exposure: f32,
  PowerDelta: f32,
  Gamma: f32,
  AnimationSpeed: f32,
}

@group(0) @binding(2) var<uniform> custom: Custom;
      `;

    registerShaderModule(device, custom);

    const computeWgsl = /* wgsl */ `
#import prelude::{screen, time, mouse};
#import math::{PI, TWO_PI, rand4, nrand4, udir, disk, Rotate, RotXY, state};
#import camera::{Camera, camera, GetCameraMatrix, Project};
#import custom::{custom};

@group(2) @binding(0) var<storage, read_write> atomic_storage : array<atomic<i32>>;

const MaxSamples = 32.0;
const FOV = 0.8;

const STEP = 0.01;
const LARGENUM = 1e10;
const ATOMIC_SCALE = 64.0;
const BULB_POWER_DELTA_MAX = 1.;
const BULB_MAX_POWER = 8.0;

fn SetCamera()
{
    let screen_size = int2(textureDimensions(screen));
    let screen_size_f = float2(screen_size);
    let ang = float2(mouse.pos.xy)*float2(-TWO_PI, PI)/screen_size_f + float2(0.4, 0.4);

    camera.fov = FOV;
    camera.cam = GetCameraMatrix(ang); 
    camera.pos = - (camera.cam*float3(5.0*custom.Radius+0.0,0.0,0.0));
    camera.size = screen_size_f;
}

const max_iterations = 256;
const color_thresholds = float4(255.0, 130.0, 80.0, 255.0);

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
    let screenCoord = int2(projectedPos.xy);

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

fn buddhabrot(iters: i32) -> vec4<f32> {
    var z: vec3<f32> = vec3<f32>(0.01, 0.01, 0.01);
    var c: vec3<f32> = (rand4().xyz - 0.5) * 1.2;

    var i: i32 = 0;
    let BULB_POWER = custom.BulbPower * BULB_MAX_POWER + 5.0*(0.5*sin(0.25*custom.AnimationSpeed*time.elapsed)+0.5);
    let BULB_POWER_DELTA = (custom.PowerDelta - 0.5) * BULB_POWER_DELTA_MAX;
    loop {
        if (i >= iters) { break; }

        let r: f32 = length(z);
        let b: f32 = (BULB_POWER + BULB_POWER_DELTA) * acos(z.y / r);
        let a: f32 =(BULB_POWER + BULB_POWER_DELTA) * atan2(z.x, z.z);
        z = c + pow(r, (BULB_POWER + BULB_POWER_DELTA)) * vec3<f32>(sin(b) * sin(a), cos(b), sin(b) * cos(a));

        if (length(z) > 4.0) {
            break;
        }
        i = i + 1;
    }

    if (i >= iters) {
        return vec4<f32>(1e5, 1e5, 1e5, 1e5);
    }

    z = vec3<f32>(0.01, 0.01, 0.01);

    for (var j: i32 = 0; j <= 64; j = j + 1) {
        let r: f32 = length(z);
        let b: f32 = BULB_POWER * acos(z.y / r);
        let a: f32 = BULB_POWER * atan2(z.x, z.z);
        z = c + pow(r, BULB_POWER) * vec3<f32>(sin(b) * sin(a), cos(b), sin(b) * cos(a));

        var color = spectral_zucconi(460 + 4.0*float(j)) + 0.025*float3(1.0,1.0,1.0);
        color = pow(color, vec3(1.0));
        RasterizePoint(z, color/(custom.Samples*MaxSamples + 1.0));
    }
  

    return vec4<f32>(z, f32(i));
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

    for(var i: i32 = 0; i < int(custom.Samples*MaxSamples + 1.0); i++)
    {
        var bud = buddhabrot(64);
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
    
    color = pow(float3(x,y,z)/ATOMIC_SCALE, vec3(2.0*custom.Gamma));

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
      viewOrSize: 8 * Float32Array.BYTES_PER_ELEMENT,
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
          options.noiseAnimation,
          (modulate(lowerAvgFr, 0, 1, 0.5, 4) / 4) * options.bulbPower,
          options.exposure + classifyOutput / 10.0,
          (modulate(upperAvgFr, 0, 1, 0.5, 4) / 4) * options.powerDelta,
          options.gamma,
          options.animationSpeed,
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

  update(options: Partial<GalaxyOptions>) {
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