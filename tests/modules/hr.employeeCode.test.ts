import { describe, it, expect } from 'vitest';
import { formatEmployeeCode, parseEmployeeCode } from '../../src/modules/hr/employeeCode';

describe('employeeCode', () => {
  it('parses Emp-01', () => {
    expect(parseEmployeeCode('Emp-01')).toEqual({
      prefix: 'Emp-',
      sequence: 1,
      padLength: 2,
    });
  });

  it('parses Employee - 00001', () => {
    expect(parseEmployeeCode('Employee - 00001')).toEqual({
      prefix: 'Employee - ',
      sequence: 1,
      padLength: 5,
    });
  });

  it('rejects without trailing digits', () => {
    expect(parseEmployeeCode('Emp-X')).toBeNull();
    expect(parseEmployeeCode('')).toBeNull();
  });

  it('formats with padding', () => {
    expect(formatEmployeeCode('Emp-', 7, 2)).toBe('Emp-07');
    expect(formatEmployeeCode('Employee - ', 1, 5)).toBe('Employee - 00001');
  });
});
