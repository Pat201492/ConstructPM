const FileService = require('../../src/services/FileService');

describe('FileService', () => {
  describe('sanitizeFolderName', () => {
    it('should replace spaces with underscores', () => {
      expect(FileService.sanitizeFolderName('New York City')).toBe('New_York_City');
    });

    it('should remove special characters', () => {
      expect(FileService.sanitizeFolderName('Project #1 (Phase 2)')).toBe('Project_1_Phase_2');
    });

    it('should preserve hyphens and underscores', () => {
      expect(FileService.sanitizeFolderName('my-project_v2')).toBe('my-project_v2');
    });

    it('should truncate to 100 characters', () => {
      const longName = 'a'.repeat(200);
      expect(FileService.sanitizeFolderName(longName).length).toBeLessThanOrEqual(100);
    });

    it('should handle empty string', () => {
      expect(FileService.sanitizeFolderName('')).toBe('');
    });

    it('should handle unicode/emoji by stripping them', () => {
      expect(FileService.sanitizeFolderName('Project 🏗️ Build')).toBe('Project_Build');
    });

    it('should collapse multiple spaces into single underscore', () => {
      expect(FileService.sanitizeFolderName('too   many   spaces')).toBe('too_many_spaces');
    });
  });
});
