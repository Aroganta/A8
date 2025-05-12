import * as lil from 'lil-gui';
import { Audio, Galaxy } from '../../src';

export function render(audio: Audio, gui: lil.GUI) {
  const shaderCompilerPath = new URL(
    '/public/glsl_wgsl_compiler_bg.wasm',
    import.meta.url,
  ).href;
  const effect = new Galaxy(shaderCompilerPath);

  const folder = gui.addFolder('style');
  const config = {
    radius: 0.45,
    samples: 0,
    noiseAnimation: 0.627,
    bulbPower: 0.503,
    exposure: 0.182,
    powerDelta: 0.9,
    gamma: 0.9,
    animationSpeed: 1,
  };

  folder.add(config, 'radius', 0, 1).onChange((radius: number) => {
    audio.style({ radius });
  });
  folder.add(config, 'samples', 0, 1).onChange((samples: number) => {
    audio.style({ samples });
  });
  folder.add(config, 'noiseAnimation', 0, 1).onChange((noiseAnimation: number) => {
    audio.style({ noiseAnimation });
  });
  folder.add(config, 'bulbPower', 0, 1).onChange((bulbPower: number) => {
    audio.style({ bulbPower });
  });
  folder.add(config, 'exposure', 0, 1).onChange((exposure: number) => {
    audio.style({ exposure });
  });
  folder.add(config, 'powerDelta', 0, 1).onChange((powerDelta: number) => {
    audio.style({ powerDelta });
  });
  folder.add(config, 'gamma', 0, 1).onChange((gamma: number) => {
    audio.style({ gamma });
  });
  folder.add(config, 'animationSpeed', 0, 1).onChange((animationSpeed: number) => {
    audio.style({ animationSpeed });
  });

  return [effect, folder];
}
