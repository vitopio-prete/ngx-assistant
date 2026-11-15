// The theme as text, to check where its rules sit (jsdom runs no stylesheet).
// @ts-expect-error -- a text import of the builder, without type declarations
import themeText from './nxa-theme.css' with { loader: 'text' };

const theme = themeText as string;

describe('nxa-theme motion', () => {
  it('plays the entrance only when the system does not ask for reduced motion', () => {
    const animations = [...theme.matchAll(/animation:\s*nxa-enter/g)];
    expect(animations).toHaveLength(1);
    const start = theme.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(start).toBeGreaterThan(-1);
    // The end of the media block: the brace that balances its opening one.
    let depth = 0;
    let end = -1;
    for (let i = theme.indexOf('{', start); i < theme.length; i++) {
      if (theme[i] === '{') depth++;
      else if (theme[i] === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    const at = animations[0]!.index;
    expect(at > start && at < end).toBe(true);
    expect(theme.slice(start, at)).toContain('.nxa-animate-in');
  });
});
