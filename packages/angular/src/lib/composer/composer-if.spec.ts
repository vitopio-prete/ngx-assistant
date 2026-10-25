import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ChatModelAdapter, ThreadMessageLike } from '@ngx-assistant/engine';
import { provideLocalRuntime } from '../local-runtime';
import { NXA_THREAD, injectComposer, injectMessage, provideMessageScope } from '../scopes';
import { NxaComposerIf, type NxaComposerIfConditions } from './composer-if';

const model: ChatModelAdapter = {
  async *run() {
    yield { content: [{ type: 'text', text: 'reply' }] };
  },
};

const initialMessages: ThreadMessageLike[] = [
  { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
];

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await fixture.whenStable();
}

const shown = (fixture: ComponentFixture<unknown>) =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('p')).map((p) => p.className);

describe('nxaComposerIf', () => {
  it('follows the edit state of a message edit composer, with the else template', async () => {
    @Component({
      selector: 'nxa-test-message',
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaComposerIf],
      providers: [provideMessageScope(() => inject(NXA_THREAD)!.getMessageByIndex(0))],
      template: `
        <p *nxaComposerIf="when(); else view" class="shown"></p>
        <ng-template #view><p class="view"></p></ng-template>
      `,
    })
    class Message {
      readonly message = injectMessage();
      readonly composer = injectComposer();
      readonly when = signal<NxaComposerIfConditions>({ editing: true });
    }
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [Message],
      providers: provideLocalRuntime(model, { initialMessages }),
      template: `<nxa-test-message />`,
    })
    class Host {}

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await settle(fixture);
    const message = fixture.debugElement.children[0]!.componentInstance as Message;
    expect(shown(fixture)).toEqual(['view']);

    message.message.composer.beginEdit();
    await settle(fixture);
    expect(shown(fixture)).toEqual(['shown']);

    message.when.set({ editing: false });
    await settle(fixture);
    expect(shown(fixture)).toEqual(['view']);

    message.composer.cancel();
    await settle(fixture);
    expect(shown(fixture)).toEqual(['shown']);
  });

  it('treats the thread composer as editing and checks dictation', async () => {
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaComposerIf],
      providers: provideLocalRuntime(model),
      template: `
        <p *nxaComposerIf="{ editing: true }" class="editing"></p>
        <p *nxaComposerIf="{ dictation: true }" class="dictating"></p>
        <p *nxaComposerIf="{ dictation: false, editing: true }" class="both"></p>
        <p *nxaComposerIf="{}" class="always"></p>
      `,
    })
    class Host {}

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await settle(fixture);
    expect(shown(fixture)).toEqual(['editing', 'both', 'always']);
  });
});
