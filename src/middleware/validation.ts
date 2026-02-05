import { Request, Response, NextFunction } from 'express';

// Input validation middleware
export function validateInput(schema: {
  body?: Record<string, (value: any) => boolean | string>;
  params?: Record<string, (value: any) => boolean | string>;
  query?: Record<string, (value: any) => boolean | string>;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];

    // Validate body
    if (schema.body) {
      for (const [key, validator] of Object.entries(schema.body)) {
        const value = req.body[key];
        const result = validator(value);
        if (result !== true) {
          errors.push(result === false ? `${key} is invalid` : result);
        }
      }
    }

    // Validate params
    if (schema.params) {
      for (const [key, validator] of Object.entries(schema.params)) {
        const value = req.params[key];
        const result = validator(value);
        if (result !== true) {
          errors.push(result === false ? `${key} is invalid` : result);
        }
      }
    }

    // Validate query
    if (schema.query) {
      for (const [key, validator] of Object.entries(schema.query)) {
        const value = req.query[key];
        const result = validator(value);
        if (result !== true) {
          errors.push(result === false ? `${key} is invalid` : result);
        }
      }
    }

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', errors });
      return;
    }

    next();
  };
}

// Common validators
export const validators = {
  required: (value: any) => {
    if (value === undefined || value === null || value === '') {
      return 'This field is required';
    }
    return true;
  },
  email: (value: any) => {
    if (!value) return true; // Optional
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value) || 'Invalid email format';
  },
  minLength: (min: number) => (value: any) => {
    if (!value) return true;
    return value.length >= min || `Must be at least ${min} characters`;
  },
  maxLength: (max: number) => (value: any) => {
    if (!value) return true;
    return value.length <= max || `Must be at most ${max} characters`;
  },
  password: (value: any) => {
    if (!value) return 'Password is required';
    if (value.length < 6) return 'Password must be at least 6 characters';
    return true;
  },
  uuid: (value: any) => {
    if (!value) return true;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value) || 'Invalid UUID format';
  },
  number: (value: any) => {
    if (value === undefined || value === null) return true;
    return !isNaN(Number(value)) || 'Must be a number';
  },
  positive: (value: any) => {
    if (value === undefined || value === null) return true;
    const num = Number(value);
    return num > 0 || 'Must be a positive number';
  },
};






