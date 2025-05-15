import {
	Bindings,
	Buffer,
	BufferUsage,
	ComputePipeline,
} from '@antv/g-device-api';
import { createProgram, registerShaderModule } from '../utils';
import { GPUParticleEffect } from './GPUParticleEffect';
import { modulate } from '../../utils';

export interface AlienOrbOptions {
	fft: number;
	exposure: number;
}

export class AlienOrb extends GPUParticleEffect {
	private options: AlienOrbOptions;
	private customUniformBuffer: Buffer;
	private mainImagePipeline: ComputePipeline;
	private mainImageBindings: Bindings;

	constructor(
		shaderCompilerPath: string,
		options: Partial<AlienOrbOptions> = {},
	) {
		super(shaderCompilerPath);

		this.options = {
			fft: 1.00,
			exposure: 0.20,
			...options,
		};
	}

	registerShaderModule() {
		const { device, screen } = this;

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

fn Rot(a: f32) -> mat2x2<f32> {
	let s: f32 = sin(a);
	var c: f32 = cos(a);
	return mat2x2<f32>(c, -s, s, c);
} 

fn smin(a: f32, b: f32, k: f32) -> f32 {
	let h: f32 = clamp(0.5 + 0.5 * (b - a) / k, 0., 1.);
	return mix(b, a, h) - k * h * (1. - h);
} 

fn Hash21(p: vec2<f32>) -> f32 {
	var p_var = p;
	p_var = fract(p_var * vec2<f32>(123.34, 234.34));
	p_var = p_var + (dot(p_var, p_var + 23.43));
	return fract(p_var.x * p_var.y);
} 

fn Gyroid(p: vec3<f32>) -> f32 {
	let scale: f32 = 10.;
	var p2: vec3<f32> = p * scale;
	var p2xy = p2.xy;
	p2xy = p2.xy * (Rot(time.elapsed * 0.1));
	p2.x = p2xy.x;
	p2.y = p2xy.y;
	return (abs(dot(sin(p2), cos(p2.zxy))) - 0.4) / scale;
} 

fn sabs(x: f32, k: f32) -> f32 {
	return sqrt(x * x + k);
} 

fn GetDist(p: vec3<f32>) -> f32 {
	let sphere: f32 = abs(length(p) - 1.) - 0.03;
	var d: f32 = smin(sphere, Gyroid(p) * 0.7, -0.03);
	var ground: f32 = p.y + 1. + smoothstep(0.01, -0.01, d) * 0.1;
	var x: f32 = p.x;
	x = p.x + (time.elapsed * 0.1 * 1.3);
	let p2: vec3<f32> = p * 5.;
	var wake: f32 = smoothstep(0.4, 0., abs(p.z));
	wake = wake * (smoothstep(0., -1., x));
	let gyroid: f32 = (sabs(dot(sin(p2), cos(p2.zxy)), wake) - 0.4) / 10.;
	ground = ground + (gyroid);
	d = min(d, ground * 0.5);
	return d;
} 

fn RayMarch(ro: vec3<f32>, rd: vec3<f32>) -> vec2<f32> {
	var dO: f32 = 0.;
	var dM: f32 = 30.;

	for (var i: i32 = 0; i < 300; i = i + 1) {
		var p: vec3<f32> = ro + rd * dO;
		var dS: f32 = GetDist(p);
		if (dS < dM) { dM = dS; }
		dO = dO + (dS);
		if (dO > 30. || abs(dS) < 0.001) {		
			break;
 		}
	}

	return vec2<f32>(dO, dM);
} 

fn GetNormal(p: vec3<f32>) -> vec3<f32> {
	var d: f32 = GetDist(p);
	let e: vec2<f32> = vec2<f32>(0.001, 0.);
	var n: vec3<f32> = d - vec3<f32>(GetDist(p - e.xyy), GetDist(p - e.yxy), GetDist(p - e.yyx));
	return normalize(n);
} 

fn RR(uv: vec2<f32>, p: vec3<f32>, l: vec3<f32>, z: f32) -> vec3<f32> {
	let f: vec3<f32> = normalize(l - p);
	let r: vec3<f32> = normalize(cross(vec3<f32>(0., 1., 0.), f));
	let u: vec3<f32> = cross(f, r);
	let c: vec3<f32> = p + f * z;
	let i: vec3<f32> = c + uv.x * r + uv.y * u;
	var d: vec3<f32> = normalize(i - p);
	return d;
} 

fn GlitterLayer(p: vec2<f32>, seed: f32) -> f32 {
	var t: f32 = time.elapsed * 3. + seed;
	let id: vec2<f32> = floor(p);
	let gv: vec2<f32> = fract(p) - 0.5;
	var n: f32 = Hash21(id);
	var x: f32 = fract(n * 12.32);
	var y: f32 = fract(n * 123.32);
	var offs: vec2<f32> = vec2<f32>(x, y) - 0.5;
	var d: f32 = length(gv - offs * 0.8);
	var m: f32 = smoothstep(0.2, 0., d);
	m = m * (pow(sin(t + n * 6.2832) * 0.5 + 0.5, 3.));
	return m;
} 

fn RayPlane(ro: vec3<f32>, rd: vec3<f32>, p: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
	var t: f32 = max(0., dot(p - ro, n) / dot(rd, n));
	return ro + rd * t;
} 

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: vec3<u32>) {
	let R = vec2f(textureDimensions(screen).xy);
    let U = vec2f(f32(id.x), R.y - f32(id.y));
	let mouseClick = mouse.click;
    let mousePos = vec2<f32>(mouse.pos);
    
	var fragColor: vec4<f32>;
	var fragCoord = vec2<f32>(f32(id.x), R.y - f32(id.y));

	let m: vec2<f32> = mousePos / R;
	var t: f32 = time.elapsed * 0.1;
	var col: vec3<f32> = vec3<f32>(0.);
	var ro: vec3<f32> = vec3<f32>(0., 1., -1.) * 2.;
	var royz = ro.yz;
	royz = ro.yz * (Rot(-m.y * 3.14 + 1.));
	ro.y = royz.x;
	ro.z = royz.y;
	var roxz = ro.xz;
	roxz = ro.xz * (Rot(m.x * 6.2831 + time.elapsed * 0.05));
	ro.x = roxz.x;
	ro.z = roxz.y;
	ro.y = max(ro.y, -0.9);

	for (var x: i32 = 0; x < 2; x = x + 1) {
		for (var y: i32 = 0; y < 2; y = y + 1) {
			var offs: vec2<f32> = vec2<f32>(f32(x), f32(y)) / f32(2.) - 0.5;
			var uv: vec2<f32> = (fragCoord + offs - 0.5 * R) / R.y;
			var rd: vec3<f32> = RR(uv, ro, vec3<f32>(0., 0., 0.), 1.);
			let dist: f32 = RayMarch(ro, rd).x;
			let lightPos: vec3<f32> = vec3<f32>(0.);
			let shadowPos: vec3<f32> = lightPos + normalize(ro - lightPos);
			var p: vec3<f32> = ro + rd * dist;
			if (dist < 30.) {
				let l: vec3<f32> = normalize(lightPos - p);
				let n: vec3<f32> = GetNormal(p);
				var dif: f32 = clamp(dot(n, l) * 0.5 + 0.5, 0., 1.);
				let d: vec2<f32> = RayMarch(lightPos, l);
				var shadow: f32; 
				if (length(p) < 1.03) { 
					shadow = 1.; 
				} else { 
					shadow = smoothstep(0.001, 0.001 * 20., d.y) * 0.6 + 0.4; 
				};
				let falloff: f32 = min(1., 1. / length(p.xz));
				dif = dif * (shadow * falloff * falloff);
				col = col + (dif);
				if (p.y < -0.9) {
					var st: vec2<f32> = p.xz;
					let offs: f32 = dot(rd, vec3<f32>(10.));
					st.x = st.x + (t * 1.3);
					var glitter: f32 = GlitterLayer(st * 10., offs);
					glitter = glitter + (GlitterLayer(st * 17. + 3.1, offs));
					glitter = glitter + (GlitterLayer(st * 23. + 23.1, offs));
					col = col + (pow(glitter, 5.) * falloff * shadow * shadow);
				}
			}
			let centerDist: f32 = length(uv);
			let g: f32 = Gyroid(shadowPos);
			let light: f32 = smoothstep(0., 0.03, g);
			col = col + (min(10., light * 0.04 * custom.fft / max(centerDist, 0.001)) * vec3<f32>(1., 0.8, 0.9));
			var sb: f32 = max(0., Gyroid(normalize(RayPlane(ro, rd, vec3<f32>(0.), normalize(ro)))));
			sb = sb * (3. * smoothstep(-0.2, 0.1, centerDist - 0.4));
			col = col + (sb);
			var sss: f32 = max(0., 1. - dot(uv, uv) * 25.);
			sss = sss * (sss);
			sss = sss * (smoothstep(2.5, 2., dist));
			sss = sss * (1. - light * 0.5);
			let P: vec3<f32> = p;
			let vein: f32 = smoothstep(-0.01, 0.02, Gyroid(P + sin(P * 30. + time.elapsed) * 0.01) + 0.03);
			sss = sss * (vein);
			col = col + (sss * vec3<f32>(1., 0.1, 0.1));
			col = col + (vec3<f32>(1., 0., 0.) * (1. - vein) * sss);
		}

	}

	col = col / (f32(2 * 2.));
	let pulse: f32 = pow(sin(time.elapsed) * 0.5 + 0.5, 150.);
	t = time.elapsed;
	let k: f32 = sin(t) + sin(t * 5.) * 0.5 + sin(t * 17.) * 0.25 + sin(t * 37.) * 0.1;
	col = col * (1. + k * 0.2);
	let uv: vec2<f32> = (fragCoord - 0.5 * R) / R.y;
	col = col * (1. - dot(uv, uv));
	col = col / (col + 3.);
	col = col * (3.);
	fragColor = vec4<f32>(col, 1.);
	let exposed = 1.0 - exp(-5.0 * custom.Exposure * fragColor.xyz / fragColor.w);
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

	update(options: Partial<AlienOrbOptions>) {
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