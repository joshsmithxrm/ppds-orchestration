import { describe, it, expect } from 'vitest';
import { parsePlanFile, getCurrentTask, isPromiseMet, Task } from './plan-parser.js';

describe('plan-parser', () => {
  const samplePlan = `# Implementation Plan

## Overview
This plan implements feature X.

### Task 0: Setup Project
- [ ] **Description**: Initialize project structure
- **Phase**: 0
- **Depends-On**: None
- **Parallel-With**: None
- **Acceptance**: Project structure exists
- **Files**: package.json
- **Test**: \`npm run build\`

### Task 1: Core Implementation
- [x] **Description**: Implement core logic
- **Phase**: 1
- **Depends-On**: 0
- **Parallel-With**: 2, 3
- **Acceptance**: Core tests pass
- **Files**: src/core.ts, src/utils.ts
- **Test**: \`npm run test -- --grep "core"\`

### Task 2: Add Tests
- [ ] **Description**: Write comprehensive tests
- **Phase**: 1
- **Depends-On**: 0
- **Parallel-With**: 1, 3
- **Acceptance**: 80% coverage
- **Files**: src/core.test.ts
- **Test**: \`npm run coverage\`
`;

  describe('parsePlanFile', () => {
    it('should parse all tasks from plan content', () => {
      const result = parsePlanFile(samplePlan);

      expect(result.tasks).toHaveLength(3);
      expect(result.summary).toEqual({
        total: 3,
        complete: 1,
        incomplete: 2,
      });
    });

    it('should extract task numbers and titles', () => {
      const result = parsePlanFile(samplePlan);

      expect(result.tasks[0].number).toBe(0);
      expect(result.tasks[0].title).toBe('Setup Project');
      expect(result.tasks[1].number).toBe(1);
      expect(result.tasks[1].title).toBe('Core Implementation');
      expect(result.tasks[2].number).toBe(2);
      expect(result.tasks[2].title).toBe('Add Tests');
    });

    it('should extract checkbox state correctly', () => {
      const result = parsePlanFile(samplePlan);

      expect(result.tasks[0].complete).toBe(false);
      expect(result.tasks[1].complete).toBe(true);
      expect(result.tasks[2].complete).toBe(false);
    });

    it('should extract description field', () => {
      const result = parsePlanFile(samplePlan);

      expect(result.tasks[0].description).toBe('Initialize project structure');
      expect(result.tasks[1].description).toBe('Implement core logic');
    });

    it('should extract phase field', () => {
      const result = parsePlanFile(samplePlan);

      expect(result.tasks[0].phase).toBe(0);
      expect(result.tasks[1].phase).toBe(1);
    });

    it('should extract dependsOn field', () => {
      const result = parsePlanFile(samplePlan);

      expect(result.tasks[0].dependsOn).toEqual([]);
      expect(result.tasks[1].dependsOn).toEqual([0]);
    });

    it('should extract parallelWith field', () => {
      const result = parsePlanFile(samplePlan);

      expect(result.tasks[0].parallelWith).toEqual([]);
      expect(result.tasks[1].parallelWith).toEqual([2, 3]);
      expect(result.tasks[2].parallelWith).toEqual([1, 3]);
    });

    it('should extract acceptance field', () => {
      const result = parsePlanFile(samplePlan);

      expect(result.tasks[0].acceptance).toBe('Project structure exists');
      expect(result.tasks[2].acceptance).toBe('80% coverage');
    });

    it('should extract files as array', () => {
      const result = parsePlanFile(samplePlan);

      expect(result.tasks[0].files).toEqual(['package.json']);
      expect(result.tasks[1].files).toEqual(['src/core.ts', 'src/utils.ts']);
    });

    it('should extract test field and strip backticks', () => {
      const result = parsePlanFile(samplePlan);

      expect(result.tasks[0].test).toBe('npm run build');
      expect(result.tasks[1].test).toBe('npm run test -- --grep "core"');
    });

    it('should handle empty content', () => {
      const result = parsePlanFile('');

      expect(result.tasks).toEqual([]);
      expect(result.summary).toEqual({
        total: 0,
        complete: 0,
        incomplete: 0,
      });
    });

    it('should handle content with no tasks', () => {
      const result = parsePlanFile('# Some Plan\n\nNo tasks here.');

      expect(result.tasks).toEqual([]);
      expect(result.summary.total).toBe(0);
    });

    it('should ignore malformed checkboxes', () => {
      const malformedPlan = `### Task 0: Bad Task
- [] **Description**: Missing space in checkbox

### Task 1: Good Task
- [ ] **Description**: Valid checkbox
- **Phase**: 0
- **Depends-On**: None
- **Parallel-With**: None
- **Acceptance**: Works
- **Files**: file.ts
- **Test**: \`npm test\`
`;

      const result = parsePlanFile(malformedPlan);

      // Only the valid task should be parsed
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].number).toBe(1);
      expect(result.tasks[0].title).toBe('Good Task');
    });

    it('should ignore checkboxes outside task sections', () => {
      const planWithExtraCheckboxes = `# Plan

- [ ] This checkbox should be ignored

### Task 0: Real Task
- [ ] **Description**: This is the real task
- **Phase**: 0
- **Depends-On**: None
- **Parallel-With**: None
- **Acceptance**: Done
- **Files**: src/main.ts
- **Test**: \`npm test\`

Some other checkbox:
- [x] Should not count
`;

      const result = parsePlanFile(planWithExtraCheckboxes);

      expect(result.tasks).toHaveLength(1);
      expect(result.summary.total).toBe(1);
      expect(result.summary.complete).toBe(0);
    });

    it('should handle all tasks complete', () => {
      const completePlan = `### Task 0: Done Task
- [x] **Description**: Completed
- **Phase**: 0
- **Depends-On**: None
- **Parallel-With**: None
- **Acceptance**: Pass
- **Files**: file.ts
- **Test**: \`npm test\`
`;

      const result = parsePlanFile(completePlan);

      expect(result.summary).toEqual({
        total: 1,
        complete: 1,
        incomplete: 0,
      });
    });

    it('should handle missing optional fields', () => {
      const minimalPlan = `### Task 0: Minimal Task
- [ ] **Description**: Just description
`;

      const result = parsePlanFile(minimalPlan);

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].phase).toBe(0);
      expect(result.tasks[0].dependsOn).toEqual([]);
      expect(result.tasks[0].parallelWith).toEqual([]);
      expect(result.tasks[0].acceptance).toBe('');
      expect(result.tasks[0].files).toEqual([]);
      expect(result.tasks[0].test).toBe('');
    });
  });

  describe('getCurrentTask', () => {
    it('should return first incomplete task', () => {
      const tasks: Task[] = [
        createTask(0, true),
        createTask(1, false),
        createTask(2, false),
      ];

      const current = getCurrentTask(tasks);

      expect(current).toBeDefined();
      expect(current?.number).toBe(1);
    });

    it('should return undefined when all tasks complete', () => {
      const tasks: Task[] = [
        createTask(0, true),
        createTask(1, true),
      ];

      const current = getCurrentTask(tasks);

      expect(current).toBeUndefined();
    });

    it('should return undefined for empty task list', () => {
      const current = getCurrentTask([]);

      expect(current).toBeUndefined();
    });

    it('should return first task if none are complete', () => {
      const tasks: Task[] = [
        createTask(0, false),
        createTask(1, false),
      ];

      const current = getCurrentTask(tasks);

      expect(current?.number).toBe(0);
    });
  });

  describe('isPromiseMet', () => {
    it('should return true when all tasks complete', () => {
      const completePlan = `### Task 0: First
- [x] **Description**: Done
- **Phase**: 0
- **Depends-On**: None
- **Parallel-With**: None
- **Acceptance**: Pass
- **Files**: a.ts
- **Test**: \`npm test\`

### Task 1: Second
- [x] **Description**: Also done
- **Phase**: 1
- **Depends-On**: 0
- **Parallel-With**: None
- **Acceptance**: Pass
- **Files**: b.ts
- **Test**: \`npm test\`
`;

      expect(isPromiseMet(completePlan)).toBe(true);
    });

    it('should return false when tasks incomplete', () => {
      expect(isPromiseMet(samplePlan)).toBe(false);
    });

    it('should return false for empty plan', () => {
      expect(isPromiseMet('')).toBe(false);
    });

    it('should return false for plan with no valid tasks', () => {
      expect(isPromiseMet('# Just a heading\n\nNo tasks here.')).toBe(false);
    });
  });
});

/**
 * Helper to create a Task for testing
 */
function createTask(number: number, complete: boolean): Task {
  return {
    number,
    title: `Task ${number}`,
    complete,
    description: `Description for task ${number}`,
    phase: 0,
    dependsOn: [],
    parallelWith: [],
    acceptance: 'Acceptance criteria',
    files: [],
    test: 'npm test',
  };
}
