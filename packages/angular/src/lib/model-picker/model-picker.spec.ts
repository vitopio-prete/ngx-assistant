import { ChangeDetectionStrategy, Component, EnvironmentInjector, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { AssistantRuntime, ChatModelAdapter, ModelContext } from '@ngx-assistant/engine';
import { provideLocalRuntime } from '../local-runtime';
import { injectAssistant } from '../scopes';
import { NxaModelPicker } from './model-picker';
import {
  NxaModelPickerContent,
  NxaModelPickerEffort,
  NxaModelPickerEffortItem,
  NxaModelPickerItem,
  NxaModelPickerList,
  NxaModelPickerSearch,
  NxaModelPickerTrigger,
} from './model-picker-parts';
import type { ModelOption } from './model-options';

const MODELS: readonly ModelOption[] = [
  { id: 'small', name: 'Small', keywords: ['fast'] },
  { id: 'medium', name: 'Medium', disabled: true },
  { id: 'large', name: 'Large', efforts: true },
  { id: 'custom', name: 'Custom', efforts: [{ id: 'max', name: 'Max' }] },
];

const PARTS = [
  NxaModelPicker,
  NxaModelPickerList,
  NxaModelPickerTrigger,
  NxaModelPickerContent,
  NxaModelPickerItem,
  NxaModelPickerSearch,
  NxaModelPickerEffort,
  NxaModelPickerEffortItem,
];

@Component({
  selector: 'nxa-test-picker',
  imports: PARTS,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <div
        nxaModelPicker
        #picker="nxaModelPicker"
        [models]="models()"
        [(value)]="value"
        [(effort)]="effort"
        [(open)]="open"
      >
        <button nxaModelPickerTrigger class="trigger">
          {{ picker.selectedModel()?.name ?? 'Select model' }}
        </button>
        <div nxaModelPickerContent class="content">
          @if (withSearch()) {
            <input nxaModelPickerSearch class="search" />
          }
          <div nxaModelPickerList aria-label="Models" class="list">
            @for (option of picker.filteredModels(); track option.id) {
              <div [nxaModelPickerItem]="option" class="item">{{ option.name }}</div>
            }
          </div>
          <p class="gap">Pick a model</p>
          <div nxaModelPickerEffort class="effort" aria-label="Effort">
            @for (level of picker.efforts() ?? []; track level.id) {
              <button [nxaModelPickerEffortItem]="level.id" class="level">{{ level.name }}</button>
            }
          </div>
        </div>
      </div>
    }
    <button class="outside">outside</button>
  `,
})
class PickerHost {
  readonly shown = signal(true);
  readonly withSearch = signal(false);
  readonly models = signal(MODELS);
  readonly value = signal<string | undefined>(undefined);
  readonly effort = signal<string | undefined>(undefined);
  readonly open = signal(false);
}

/** A model that records the model context of each run. */
const recordingModel = () => {
  const contexts: ModelContext[] = [];
  const model: ChatModelAdapter = {
    async *run({ context }) {
      contexts.push(context);
      yield { content: [{ type: 'text', text: 'ok' }] };
    },
  };
  return { model, contexts };
};

let fixture: ComponentFixture<PickerHost>;
let contexts: ModelContext[];
let assistant: AssistantRuntime;

const setup = async (configure: (host: PickerHost) => void = () => undefined) => {
  const recording = recordingModel();
  contexts = recording.contexts;
  TestBed.configureTestingModule({ providers: [provideLocalRuntime(recording.model)] });
  assistant = TestBed.inject(EnvironmentInjector).runInContext(() => injectAssistant());
  fixture = TestBed.createComponent(PickerHost);
  document.body.appendChild(fixture.nativeElement);
  configure(fixture.componentInstance);
  await render();
};

const render = () => fixture.whenStable();

const el = <T extends HTMLElement = HTMLElement>(selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelector<T>(selector)!;
const all = (selector: string) =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(selector));

const press = async (target: HTMLElement, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  await render();
  return event;
};

const click = async (target: HTMLElement) => {
  target.click();
  await render();
};

const highlighted = () => all('.item').find((item) => item.hasAttribute('data-highlighted'));

const send = async (text: string) => {
  const before = contexts.length;
  assistant.thread.append(text);
  await vi.waitFor(() =>
    expect(contexts.length === before + 1 && !assistant.thread.getState().isRunning).toBe(true),
  );
  return contexts.at(-1)!;
};

afterEach(() => {
  fixture?.nativeElement.remove();
});

describe('nxaModelPicker', () => {
  it('starts closed on the first model, with the combobox and listbox roles', async () => {
    await setup();
    const trigger = el('.trigger');
    const content = el('.content');

    expect(trigger.textContent!.trim()).toBe('Small');
    expect(trigger.getAttribute('role')).toBe('combobox');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe(el('.list').id);
    expect(trigger.getAttribute('type')).toBe('button');
    expect(el('.list').getAttribute('role')).toBe('listbox');
    expect(content.hasAttribute('role')).toBe(false);
    expect(content.hidden).toBe(true);
    expect(el('[nxaModelPicker]').getAttribute('data-state')).toBe('closed');
    expect(all('.item').map((i) => i.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(all('.item')[1]!.getAttribute('aria-disabled')).toBe('true');
    expect(all('.item')[1]!.hasAttribute('data-disabled')).toBe(true);
  });

  it('opens on click on the chosen model, and a click on an option picks it and closes', async () => {
    await setup((host) => host.value.set('large'));
    const trigger = el('.trigger');
    trigger.focus();

    await click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(el('.content').hidden).toBe(false);
    expect(highlighted()?.textContent).toBe('Large');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(highlighted()!.id);

    await click(all('.item')[0]!);
    expect(fixture.componentInstance.value()).toBe('small');
    expect(el('.content').hidden).toBe(true);
    expect(trigger.textContent!.trim()).toBe('Small');
    expect(document.activeElement).toBe(trigger);
  });

  it('ignores a click on a disabled option', async () => {
    await setup();
    await click(el('.trigger'));

    await click(all('.item')[1]!);

    expect(fixture.componentInstance.value()).toBeUndefined();
    expect(el('.content').hidden).toBe(false);
  });

  it('drives the list from the keyboard, skipping disabled options', async () => {
    await setup();
    const trigger = el('.trigger');
    trigger.focus();

    expect((await press(trigger, 'ArrowDown')).defaultPrevented).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(highlighted()?.textContent).toBe('Small');

    await press(trigger, 'ArrowDown');
    expect(highlighted()?.textContent).toBe('Large');
    await press(trigger, 'ArrowUp');
    expect(highlighted()?.textContent).toBe('Small');
    await press(trigger, 'ArrowUp');
    expect(highlighted()?.textContent).toBe('Small');
    await press(trigger, 'End');
    expect(highlighted()?.textContent).toBe('Custom');
    await press(trigger, 'ArrowDown');
    expect(highlighted()?.textContent).toBe('Custom');
    await press(trigger, 'Home');
    expect(highlighted()?.textContent).toBe('Small');
    await press(trigger, 'End');

    expect((await press(trigger, 'Enter')).defaultPrevented).toBe(true);
    expect(fixture.componentInstance.value()).toBe('custom');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('closes on Escape with the focus back on the trigger, without letting Escape out', async () => {
    await setup((host) => host.withSearch.set(true));
    const trigger = el('.trigger');
    trigger.focus();
    await press(trigger, 'ArrowDown');
    await render();
    expect(document.activeElement).toBe(el('.search'));
    const outer = vi.fn();
    document.addEventListener('keydown', outer);

    const escape = await press(el('.search'), 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(el('.content').hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(outer).not.toHaveBeenCalled();

    // Closed, Escape is left to whatever is around the picker.
    await press(trigger, 'Escape');
    expect(outer).toHaveBeenCalledOnce();
    document.removeEventListener('keydown', outer);
  });

  it('keeps the list open while the focus moves inside the picker, and closes when it leaves', async () => {
    await setup((host) => {
      host.withSearch.set(true);
      host.value.set('large');
    });
    await click(el('.trigger'));
    await render();
    const search = el('.search');
    const level = all('.level')[0]!;

    level.focus();
    await render();
    expect(el('.content').hidden).toBe(false);
    expect(document.activeElement).toBe(level);

    search.focus();
    el('.outside').focus();
    await render();
    expect(el('.content').hidden).toBe(true);
    expect(document.activeElement).toBe(el('.outside'));
  });

  it('keeps the focus on the search on a pointer down on a part that takes no focus', async () => {
    await setup((host) => host.withSearch.set(true));
    await click(el('.trigger'));
    await render();

    const gap = new Event('pointerdown', { bubbles: true, cancelable: true });
    el('.gap').dispatchEvent(gap);
    const search = new Event('pointerdown', { bubbles: true, cancelable: true });
    el('.search').dispatchEvent(search);

    expect(gap.defaultPrevented).toBe(true);
    expect(search.defaultPrevented).toBe(false);
  });

  it('picks with Space on the open trigger, without the keyup reopening it', async () => {
    await setup();
    const trigger = el('.trigger');
    trigger.focus();
    await press(trigger, 'ArrowDown');
    await press(trigger, 'ArrowDown');

    expect((await press(trigger, ' ')).defaultPrevented).toBe(true);
    const keyup = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
    trigger.dispatchEvent(keyup);
    await render();

    expect(keyup.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.value()).toBe('large');
    expect(el('.content').hidden).toBe(true);
  });

  it('follows the open binding: starts on the chosen model and clears the search on close', async () => {
    await setup((host) => {
      host.withSearch.set(true);
      host.value.set('custom');
    });
    fixture.componentInstance.open.set(true);
    await render();
    expect(el('.content').hidden).toBe(false);
    expect(highlighted()?.textContent).toBe('Custom');
    expect(document.activeElement).toBe(el('.search'));

    const search = el<HTMLInputElement>('.search');
    search.value = 'small';
    search.dispatchEvent(new Event('input'));
    await render();
    fixture.componentInstance.open.set(false);
    await render();

    expect(search.value).toBe('');
    fixture.componentInstance.open.set(true);
    await render();
    expect(all('.item')).toHaveLength(4);
    expect(highlighted()?.textContent).toBe('Custom');
  });

  it('writes the open state back to the binding', async () => {
    await setup();
    await click(el('.trigger'));
    expect(fixture.componentInstance.open()).toBe(true);
    el('.outside').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await render();
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('moves the highlight when the models change while open', async () => {
    await setup((host) => host.value.set('large'));
    await click(el('.trigger'));
    expect(highlighted()?.textContent).toBe('Large');

    fixture.componentInstance.models.set(MODELS.filter((m) => m.id !== 'large'));
    await render();
    expect(highlighted()?.textContent).toBe('Small');

    fixture.componentInstance.models.set([]);
    await render();
    expect(highlighted()).toBeUndefined();
    expect(el('.trigger').hasAttribute('aria-activedescendant')).toBe(false);
    await press(el('.trigger'), 'ArrowDown');
    await press(el('.trigger'), 'Enter');
    expect(fixture.componentInstance.value()).toBe('large');
  });

  it('ignores keys while an IME composes', async () => {
    await setup((host) => host.withSearch.set(true));
    await click(el('.trigger'));
    await render();

    for (const key of ['Enter', 'Escape', 'ArrowDown']) {
      el('.search').dispatchEvent(
        new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true }),
      );
    }
    await render();

    expect(fixture.componentInstance.value()).toBeUndefined();
    expect(el('.content').hidden).toBe(false);
    expect(highlighted()?.textContent).toBe('Small');
  });

  it('closes on a pointer down outside, but not inside', async () => {
    await setup();
    await click(el('.trigger'));

    all('.item')[0]!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await render();
    expect(el('.content').hidden).toBe(false);

    el('.outside').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await render();
    expect(el('.content').hidden).toBe(true);
  });

  it('highlights the option under the pointer', async () => {
    await setup();
    await click(el('.trigger'));

    all('.item')[2]!.dispatchEvent(new Event('pointermove', { bubbles: true }));
    await render();
    expect(highlighted()?.textContent).toBe('Large');

    all('.item')[1]!.dispatchEvent(new Event('pointermove', { bubbles: true }));
    await render();
    expect(highlighted()?.textContent).toBe('Large');
  });

  it('filters by id, name and keywords, and clears the search on close', async () => {
    await setup((host) => host.withSearch.set(true));
    await click(el('.trigger'));
    const search = el<HTMLInputElement>('.search');
    expect(search.getAttribute('role')).toBe('combobox');
    expect(search.getAttribute('aria-controls')).toBe(el('.list').id);

    search.value = 'FAST';
    search.dispatchEvent(new Event('input'));
    await render();
    expect(all('.item').map((i) => i.textContent)).toEqual(['Small']);

    search.value = 'cus';
    search.dispatchEvent(new Event('input'));
    await render();
    expect(all('.item').map((i) => i.textContent)).toEqual(['Custom']);
    // The highlighted option was filtered out: the first one left takes it.
    expect(highlighted()?.textContent).toBe('Custom');
    expect(search.getAttribute('aria-activedescendant')).toBe(highlighted()!.id);

    await press(search, 'Enter');
    expect(fixture.componentInstance.value()).toBe('custom');
    expect(search.value).toBe('');
    expect(all('.item')).toHaveLength(4);
  });

  it('keeps the option ids stable while the search filters', async () => {
    await setup((host) => host.withSearch.set(true));
    await click(el('.trigger'));
    const idOfLarge = all('.item')[2]!.id;
    const search = el<HTMLInputElement>('.search');

    search.value = 'large';
    search.dispatchEvent(new Event('input'));
    await render();

    expect(all('.item')[0]!.id).toBe(idOfLarge);
  });

  it('shows the effort levels of the chosen model and keeps the choice across switches', async () => {
    await setup();
    const picker = fixture.debugElement.children[0]!.injector.get(NxaModelPicker);
    expect(el('.effort').hidden).toBe(true);

    fixture.componentInstance.value.set('large');
    await render();
    expect(el('.effort').hidden).toBe(false);
    expect(el('.effort').getAttribute('role')).toBe('radiogroup');
    const levels = all('.level');
    expect(levels.map((l) => l.textContent)).toEqual(['Low', 'Med', 'High']);
    expect(levels.map((l) => l.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(levels[0]!.getAttribute('role')).toBe('radio');

    await click(levels[2]!);
    expect(fixture.componentInstance.effort()).toBe('high');
    expect(levels[2]!.getAttribute('aria-checked')).toBe('true');
    expect(levels[2]!.getAttribute('data-state')).toBe('checked');
    expect(levels.map((l) => l.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);

    fixture.componentInstance.value.set('small');
    await render();
    expect(picker.activeEffort()).toBeUndefined();
    expect(el('.effort').hidden).toBe(true);

    fixture.componentInstance.value.set('large');
    await render();
    expect(picker.activeEffort()).toBe('high');
  });

  it('moves between effort levels with the arrows', async () => {
    await setup((host) => host.value.set('large'));
    await click(el('.trigger'));
    const levels = all('.level');
    levels[0]!.focus();

    const event = await press(levels[0]!, 'ArrowRight');
    expect(event.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.effort()).toBe('medium');
    expect(document.activeElement).toBe(levels[1]);

    await press(levels[1]!, 'ArrowLeft');
    await press(levels[0]!, 'ArrowUp');
    expect(fixture.componentInstance.effort()).toBe('high');
    // The list stays open while the effort changes.
    expect(el('.content').hidden).toBe(false);
  });
});

describe('nxaModelPicker and the model context', () => {
  it('sends the chosen model and the effort it supports with every run', async () => {
    await setup();

    expect((await send('one')).config).toEqual({ modelName: 'small' });

    fixture.componentInstance.value.set('large');
    fixture.componentInstance.effort.set('high');
    await render();
    expect((await send('two')).config).toEqual({ modelName: 'large', reasoningEffort: 'high' });

    // `custom` does not support `high`: no effort is sent.
    fixture.componentInstance.value.set('custom');
    await render();
    expect((await send('three')).config).toEqual({ modelName: 'custom' });
  });

  it('notifies the thread when the choice changes', async () => {
    await setup();
    const updates = vi.fn();
    assistant.thread.unstable_on('modelContextUpdate', updates);

    fixture.componentInstance.value.set('large');
    await render();

    expect(updates).toHaveBeenCalledOnce();
    expect(assistant.thread.getModelContext().config).toEqual({ modelName: 'large' });
  });

  it('removes the choice when the picker is destroyed', async () => {
    await setup();
    fixture.componentInstance.shown.set(false);
    await render();

    expect((await send('one')).config).toBeUndefined();
  });

  it('sends a value that is not in the list as it is, with no selected model', async () => {
    await setup((host) => host.value.set('elsewhere'));

    expect((await send('one')).config).toEqual({ modelName: 'elsewhere' });
    expect(el('.trigger').textContent!.trim()).toBe('Select model');
  });

  it('hides the effort levels of a model with an empty list of them', async () => {
    await setup((host) => {
      host.models.set([{ id: 'none', name: 'None', efforts: [] }]);
      host.effort.set('high');
    });

    expect(el('.effort').hidden).toBe(true);
    expect((await send('one')).config).toEqual({ modelName: 'none' });
  });

  it('sends no model while the list is empty', async () => {
    await setup((host) => host.models.set([]));

    expect((await send('one')).config).toBeUndefined();
    expect(el('.trigger').textContent!.trim()).toBe('Select model');
  });

  it('works without a runtime, keeping only the state', async () => {
    @Component({
      selector: 'nxa-test-bare-picker',
      imports: PARTS,
      template: `
        <div nxaModelPicker #picker="nxaModelPicker" [models]="models">
          <button nxaModelPickerTrigger class="trigger">{{ picker.selectedModel()?.name }}</button>
        </div>
      `,
    })
    class BarePicker {
      readonly models = MODELS;
    }
    const bare = TestBed.createComponent(BarePicker);
    await bare.whenStable();

    expect((bare.nativeElement as HTMLElement).querySelector('.trigger')!.textContent!.trim()).toBe(
      'Small',
    );
  });
});
