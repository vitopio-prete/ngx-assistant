import packageJson from '../../package.json';
import { NXA_VERSION } from './version';

describe('NXA_VERSION', () => {
  it('matches the package version', () => {
    expect(NXA_VERSION).toBe(packageJson.version);
  });
});
