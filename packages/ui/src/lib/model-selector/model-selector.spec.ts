import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { injectAssistant, provideLocalRuntime, type ModelOption } from '@ngx-assistant/angular';
import type { ChatModelAdapter, ModelContext } from '@ngx-assistant/engine';
import { axeViolations } from '../../testing/a11y';
import { keydown, slots, texts, typeInto, until } from '../../testing/thread-list-harness';
import { NxaModelSelector } from './model-selector';

const MODELS: ModelOption[] = [
  { id: 'small', name: 'Small', description: 'Fast and cheap' },
  { id: 'medium', name: 'Medium', disabled: true },
  { id: 'large', name: 'Large', efforts: true },
];

const MANY: ModelOption[] = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((name) => ({
  id: name.toLowerCase(),
  name,
}));

const contexts: ModelContext[] = [];
const model: ChatModelAdapter = {
  async *run({ context }) {
    contexts.push(context);
    yield { content: [{ type: 'text', text: 'ok' }] };
  },
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaModelSelector],
  providers: [provideLocalRuntime(model)],
  template: `
    <nxa-model-selector [models]="models()" [(value)]="value" [(effort)]="effort" [side]="side()" />
    <button class="outside">Outside</button>
  `,
})
class Host {
  readonly models = signal(MODELS);
  readonly value = signal<string | undefined>(undefined);
  readonly effort = signal<string | undefined>(undefined);
  readonly side = signal<'top' | 'bottom'>('bottom');
  readonly assistant = injectAssistant();
}

let fixture: ComponentFixture<Host>;
const el = () => fixture.nativeElement as HTMLElement;
const trigger = () => slots(el(), 'model-selector-trigger')[0]!;
const content = () => slots(el(), 'model-selector-content')[0]!;
const item = (name: string) =>
  slots(el(), 'model-selector-item').find((node) => node.textContent?.includes(name))!;

async function mount(configure: (host: Host) => void = () => undefined) {
  fixture = TestBed.createComponent(Host);
  configure(fixture.componentInstance);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
}

const open = async () => {
  trigger().click();
  await until(fixture, () => expect(content().hidden).toBe(false));
};

afterEach(() => {
  contexts.length = 0;
  document.body.replaceChildren();
});

describe('nxa-model-selector', () => {
  it('shows the first model until one is picked, and puts the pick in the model context', async () => {
    await mount();
    expect(trigger().textContent).toContain('Small');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(content().hidden).toBe(true);

    await open();
    expect(
      slots(el(), 'model-selector-item').map((node) => node.querySelector('span')?.textContent),
    ).toEqual(['Small', 'Medium', 'Large']);
    expect(item('Small').textContent).toContain('Fast and cheap');
    expect(trigger().getAttribute('aria-label')).toBe('Model: Small');
    expect(item('Medium').getAttribute('aria-disabled')).toBe('true');
    expect(item('Small').getAttribute('aria-selected')).toBe('true');

    item('Large').click();
    await until(fixture, () => expect(content().hidden).toBe(true));
    expect(fixture.componentInstance.value()).toBe('large');
    expect(trigger().textContent).toContain('Large');

    await fixture.componentInstance.assistant.thread.append('hi');
    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    expect(contexts[0]!.config?.modelName).toBe('large');
  });

  it('offers the effort levels of a model that has them and shows the chosen one', async () => {
    await mount((host) => host.value.set('large'));
    await open();
    expect(texts(el(), 'model-selector-effort-item')).toEqual(['Low', 'Med', 'High']);
    expect(slots(el(), 'model-selector-effort')[0]!.hidden).toBe(false);

    slots(el(), 'model-selector-effort-item')[2]!.click();
    await until(fixture, () => expect(fixture.componentInstance.effort()).toBe('high'));
    expect(trigger().textContent).toContain('· High');
    expect(trigger().getAttribute('aria-label')).toBe('Model: Large, High effort');
    expect(slots(el(), 'model-selector-effort-item')[2]!.getAttribute('aria-checked')).toBe('true');

    fixture.componentInstance.value.set('small');
    await until(fixture, () => expect(trigger().textContent).not.toContain('·'));
    expect(slots(el(), 'model-selector-effort')[0]!.hidden).toBe(true);
  });

  it('searches only with many models, and says when nothing matches', async () => {
    await mount();
    await open();
    expect(slots(el(), 'model-selector-search')).toHaveLength(0);

    fixture.componentInstance.models.set(MANY);
    await until(fixture, () => expect(slots(el(), 'model-selector-search')).toHaveLength(1));
    typeInto(slots(el(), 'model-selector-search')[0] as HTMLInputElement, 'zzz');
    await until(fixture, () =>
      expect(texts(el(), 'model-selector-empty')).toEqual(['No models found']),
    );
  });

  it('picks from the keyboard and closes on Escape with the focus back on the button', async () => {
    await mount();
    trigger().focus();
    keydown(trigger(), 'ArrowDown');
    await until(fixture, () => expect(content().hidden).toBe(false));

    keydown(trigger(), 'Escape');
    await until(fixture, () => expect(content().hidden).toBe(true));
    expect(document.activeElement).toBe(trigger());
  });

  it('opens above the button with side top', async () => {
    await mount((host) => host.side.set('top'));
    expect(content().classList).toContain('bottom-full');
    expect(content().classList).not.toContain('top-full');
  });

  it('has no axe violations, closed and open', async () => {
    await mount((host) => host.value.set('large'));
    expect(await axeViolations(el())).toEqual([]);
    await open();
    expect(await axeViolations(el())).toEqual([]);
  });
});
