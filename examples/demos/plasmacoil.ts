import * as lil from 'lil-gui';
import { Audio, PlasmaCoil } from '../../src';

export function render(audio: Audio, gui: lil.GUI) {
  const shaderCompilerPath = new URL(
    '/public/glsl_wgsl_compiler_bg.wasm',
    import.meta.url,
  ).href;
  const effect = new PlasmaCoil(shaderCompilerPath);

  const folder = gui.addFolder('style');
  const config = {
    radius: 0.220,
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
  };

  folder.add(config, 'radius', 0, 1).onChange((radius: number) => {
    audio.style({ radius });
  });
  folder.add(config, 'samples', 0, 32).onChange((samples: number) => {
    audio.style({ samples });
  });
  folder.add(config, 'accumulation', 0, 1).onChange((accumulation: number) => {
    audio.style({ accumulation });
  });
  folder.add(config, 'noiseAnimation', 0, 1).onChange((noiseAnimation: number) => {
    audio.style({ noiseAnimation });
  });
  folder.add(config, 'exposure', 0, 2).onChange((exposure: number) => {
    audio.style({ exposure });
  });
  folder.add(config, 'pa', 0, 1).onChange((pa: number) => {
    audio.style({ pa });
  });
  folder.add(config, 'pb', 0, 1).onChange((pb: number) => {
    audio.style({ pb });
  });
  folder.add(config, 'pc', 0, 1).onChange((pc: number) => {
    audio.style({ pc });
  });
  folder.add(config, 'pd', 0, 6).onChange((pd: number) => {
    audio.style({ pd });
  });
  folder.add(config, 'pe', 0, 5).onChange((pe: number) => {
    audio.style({ pe });
  });
  folder.add(config, 'pf', 0, 1).onChange((pf: number) => {
    audio.style({ pf });
  });
  folder.add(config, 'dt', 0, 1).onChange((dt: number) => {
    audio.style({ dt });
  });

  return [effect, folder];
}