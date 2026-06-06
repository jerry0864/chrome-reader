import { EpubReader } from './EpubReader.js';
import { MobiReader } from './MobiReader.js';

export function createReader(fileName) {
  if (/\.(mobi|azw3?)$/i.test(fileName)) return new MobiReader();
  return new EpubReader();
}
