import { pipeline } from '@huggingface/transformers';
import { WaveFile } from 'wavefile';

let genreTranscriber;
let genreReady;

async function initGenreClassifier() {
  if (!genreTranscriber) {
    genreReady = pipeline(
      'audio-classification',
       'Aroganta/music_genres_classification_onnx'
    ).then((transcriber) => {
      genreTranscriber = transcriber;
    });
  }
  return genreReady;
}

async function classifyGenre(wavFile) {
  await initGenreClassifier();

  const wav = new WaveFile(wavFile);
  wav.toBitDepth('32f');
  wav.toSampleRate(16000);
  let audioData = wav.getSamples();
  if (Array.isArray(audioData)) {
    if (audioData.length > 1) {
      const SCALING_FACTOR = Math.sqrt(2);
      for (let i = 0; i < audioData[0].length; ++i) {
        audioData[0][i] = SCALING_FACTOR * (audioData[0][i] + audioData[1][i]) / 2;
      }
    }
    audioData = audioData[0];
  }

  const start = performance.now();
  const output = await genreTranscriber(audioData);
  const classifyLabel = output[0].label;
  let classifyOutput;
  switch (classifyLabel) {
    case 'blues': classifyOutput = 1; break;
    case 'classical': classifyOutput = 2; break;
    case 'metal': classifyOutput = 3; break;
    case 'rock': classifyOutput = 4; break;
    case 'jazz': classifyOutput = 5; break;
    case 'pop': classifyOutput = 6; break;
    case 'country': classifyOutput = 7; break;
    case 'hip-hop': classifyOutput = 8; break;
    case'reggae': classifyOutput = 9; break;
    case 'disco': classifyOutput = 10; break;
    default: classifyOutput = 0;
  }
  const end = performance.now();
  const classifyTime = end - start;

  return { classifyLabel, classifyTime, classifyOutput };
}

self.onmessage = async function (event) { 
  const result = await classifyGenre(event.data);
  self.postMessage(result);
};