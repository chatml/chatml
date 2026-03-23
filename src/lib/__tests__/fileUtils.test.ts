import { describe, it, expect } from 'vitest';
import { isBinaryFile } from '../fileUtils';

describe('isBinaryFile', () => {
  describe('identifies binary files', () => {
    it.each([
      // Images
      'photo.png', 'image.jpg', 'avatar.jpeg', 'anim.gif', 'icon.ico',
      'banner.webp', 'diagram.tiff', 'photo.avif',
      // Videos
      'clip.mp4', 'video.webm', 'movie.avi', 'recording.mov',
      // Audio
      'song.mp3', 'sound.wav', 'track.ogg', 'music.flac', 'audio.aac',
      // Archives
      'bundle.zip', 'archive.tar', 'compressed.gz', 'package.7z',
      // Documents
      'report.pdf', 'document.docx', 'spreadsheet.xlsx',
      // Executables
      'app.exe', 'lib.dll', 'module.so', 'library.dylib',
      // Fonts
      'font.ttf', 'typeface.woff', 'webfont.woff2',
      // Other
      'data.sqlite', 'cache.db', 'Module.class', 'script.pyc',
    ])('%s is binary', (filename) => {
      expect(isBinaryFile(filename)).toBe(true);
    });
  });

  describe('identifies text files', () => {
    it.each([
      'README.md', 'index.ts', 'style.css', 'app.tsx', 'config.json',
      'Makefile', 'Dockerfile', '.gitignore', 'main.go', 'lib.rs',
      'script.py', 'page.html', 'query.sql', 'schema.graphql',
    ])('%s is not binary', (filename) => {
      expect(isBinaryFile(filename)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles files with no extension', () => {
      expect(isBinaryFile('Makefile')).toBe(false);
    });

    it('handles files with multiple dots', () => {
      expect(isBinaryFile('archive.tar.gz')).toBe(true);
    });

    it('is case-insensitive for extensions', () => {
      expect(isBinaryFile('photo.PNG')).toBe(true);
      expect(isBinaryFile('image.JPG')).toBe(true);
    });

    it('handles empty filename', () => {
      expect(isBinaryFile('')).toBe(false);
    });
  });
});
