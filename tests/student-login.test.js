// Login and password of a student: checks before sending (the server checks again, see tests/sql/password.test.js)
import { describe, it, expect } from 'vitest';
import { checkLogin, errorText } from '../src/sync/code.js';

describe('student login check', () => {
  it('login: Latin letters and digits, 3-30; password 8-72; both passwords equal', () => {
    expect(checkLogin('arman2014', 'secret123', 'secret123')).toBe('');
    expect(checkLogin('ar', 'secret123')).toBe('bad_login');
    expect(checkLogin('арман', 'secret123')).toBe('bad_login');
    expect(checkLogin('arman_1', 'secret123')).toBe('bad_login');
    expect(checkLogin('arman', 'short')).toBe('bad_password');
    expect(checkLogin('arman', 'secret123', 'secret124')).toBe('password_mismatch');
  });
  it('plain messages; unknown login and wrong password read the same', () => {
    expect(errorText('invalid_login')).toBe('Логин или пароль не подошли. Проверьте и попробуйте ещё раз.');
    expect(errorText('login_taken')).toMatch(/занят/);
  });
});
