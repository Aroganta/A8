import * as lil from 'lil-gui';
import { Audio, Bifurcation } from '../../src';

export function render(audio: Audio, gui: lil.GUI) {
  const shaderCompilerPath = new URL(
    '/public/glsl_wgsl_compiler_bg.wasm',
    import.meta.url,
  ).href;
  const effect = new Bifurcation(shaderCompilerPath);

  const folder = gui.addFolder('style');
  const config = {
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
  };

  folder.add(config, 'radius', 0, 1).onChange((radius: number) => {
    audio.style({ radius });
  });
  folder.add(config, 'samples', 0, 1).onChange((samples: number) => {
    audio.style({ samples });
  });
  folder.add(config, 'accumulation', 0, 1).onChange((accumulation: number) => {
    audio.style({ accumulation });
  });
  folder.add(config, 'noiseAnimation', 0, 1).onChange((noiseAnimation: number) => {
    audio.style({ noiseAnimation });
  });
  folder.add(config, 'exposure', 0, 1).onChange((exposure: number) => {
    audio.style({ exposure });
  });
  folder.add(config, 'beta', 0, 1).onChange((beta: number) => {
      audio.style({ beta });
  });
  folder.add(config, 'alpha', 0, 1).onChange((alpha: number) => {
      audio.style({ alpha });
  });
  folder.add(config, 'betaAnim', 0, 1).onChange((betaAnim: number) => {
    audio.style({ betaAnim });
  });
  folder.add(config, 'betaS', 0, 1).onChange((betaS: number) => {
    audio.style({ betaS });
  });
  folder.add(config, 'gamma', 0, 1).onChange((gamma: number) => {
    audio.style({ gamma });
  });
  folder.add(config, 'epsilon', 0, 1).onChange((epsilon: number) => {
    audio.style({ epsilon });
  });
  folder.add(config, 'betaA', 0, 1).onChange((betaA: number) => {
    audio.style({ betaA });
  });
  folder.add(config, 'betaB', 0, 1).onChange((betaB: number) => {
    audio.style({ betaB });
  });
  
  return [effect, folder];
}
