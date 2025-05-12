import * as lil from 'lil-gui';
import { Audio, Universe } from '../../src';

export function render(audio: Audio, gui: lil.GUI) {
  const shaderCompilerPath = new URL(
    '/public/glsl_wgsl_compiler_bg.wasm',
    import.meta.url,
  ).href;
  const effect = new Universe(shaderCompilerPath);

  const folder = gui.addFolder('style');
  const config = {
    fft: 1.00,
    exposure: 0.30,
  };

  folder.add(config, 'fft', 0, 1).onChange((fft: number) => {
    audio.style({ fft });
  });
  folder.add(config, 'exposure', 0, 1).onChange((exposure: number) => {
    audio.style({ exposure });
  }); 

  return [effect, folder];
}
