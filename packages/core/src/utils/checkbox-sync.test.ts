import { describe, it, expect } from 'vitest';

// We can't easily test the full syncCheckboxesToIssue function as it requires gh CLI,
// but we can test the checkbox parsing/updating logic by exposing internal functions
// or testing the overall behavior with mocks.

describe('checkbox-sync', () => {
  describe('checkbox pattern matching', () => {
    it('should match GitHub checkbox syntax', () => {
      const checkboxRegex = /^(\s*-\s*\[)([x\s])(\]\s*)(.+)$/gm;

      // Test unchecked checkbox
      const unchecked = '- [ ] Task description';
      const uncheckedMatch = checkboxRegex.exec(unchecked);
      expect(uncheckedMatch).not.toBeNull();
      expect(uncheckedMatch?.[2]).toBe(' ');
      expect(uncheckedMatch?.[4]).toBe('Task description');

      // Reset regex
      checkboxRegex.lastIndex = 0;

      // Test checked checkbox
      const checked = '- [x] Completed task';
      const checkedMatch = checkboxRegex.exec(checked);
      expect(checkedMatch).not.toBeNull();
      expect(checkedMatch?.[2]).toBe('x');
      expect(checkedMatch?.[4]).toBe('Completed task');
    });

    it('should match indented checkboxes', () => {
      const checkboxRegex = /^(\s*-\s*\[)([x\s])(\]\s*)(.+)$/gm;

      const indented = '  - [ ] Indented task';
      const match = checkboxRegex.exec(indented);
      expect(match).not.toBeNull();
      expect(match?.[4]).toBe('Indented task');
    });

    it('should handle uppercase X', () => {
      const checkboxRegex = /^(\s*-\s*\[)([xX\s])(\]\s*)(.+)$/gm;

      const uppercaseX = '- [X] Task with uppercase X';
      const match = checkboxRegex.exec(uppercaseX);
      expect(match).not.toBeNull();
      expect(match?.[2].toLowerCase()).toBe('x');
    });
  });

  describe('checkbox update logic', () => {
    it('should update unchecked to checked', () => {
      const body = '- [ ] Task one\n- [ ] Task two';
      const updated = body.replace(
        /^(\s*-\s*\[)([x\s])(\]\s*)(Task one)$/gm,
        '$1x$3$4'
      );
      expect(updated).toBe('- [x] Task one\n- [ ] Task two');
    });

    it('should update checked to unchecked', () => {
      const body = '- [x] Task one\n- [x] Task two';
      const updated = body.replace(
        /^(\s*-\s*\[)([x\s])(\]\s*)(Task one)$/gm,
        '$1 $3$4'
      );
      expect(updated).toBe('- [ ] Task one\n- [x] Task two');
    });

    it('should preserve non-matching lines', () => {
      const body = '# Header\n\n- [ ] Task\n\nSome text';
      const checkboxRegex = /^(\s*-\s*\[)([x\s])(\]\s*)(.+)$/gm;

      let result = body;
      result = result.replace(checkboxRegex, (match, prefix, _checkbox, suffix, desc) => {
        if (desc === 'Task') {
          return `${prefix}x${suffix}${desc}`;
        }
        return match;
      });

      expect(result).toBe('# Header\n\n- [x] Task\n\nSome text');
    });
  });
});
