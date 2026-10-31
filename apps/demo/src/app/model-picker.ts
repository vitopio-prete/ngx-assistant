import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  NxaModelPicker,
  NxaModelPickerContent,
  NxaModelPickerEffort,
  NxaModelPickerEffortItem,
  NxaModelPickerItem,
  NxaModelPickerList,
  NxaModelPickerTrigger,
  type ModelOption,
} from '@ngx-assistant/angular';

/** The models the demo backend knows: the request names the one picked. */
const MODELS: readonly ModelOption[] = [
  { id: 'echo', name: 'Echo', description: 'Repeats your message', efforts: true },
  { id: 'shout', name: 'Shout', description: 'Repeats it in capitals' },
];

/**
 * Picks the model, and its reasoning effort, for every conversation: the choice goes in the model
 * context of the thread list, which hands it to the runtime of each thread.
 */
@Component({
  selector: 'nxa-demo-model-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaModelPicker,
    NxaModelPickerTrigger,
    NxaModelPickerContent,
    NxaModelPickerList,
    NxaModelPickerItem,
    NxaModelPickerEffort,
    NxaModelPickerEffortItem,
  ],
  template: `
    <div
      nxaModelPicker
      #picker="nxaModelPicker"
      class="model-picker"
      [models]="models"
      [(value)]="model"
      [(effort)]="effort"
    >
      <button nxaModelPickerTrigger class="model-trigger">
        {{ picker.selectedModel()?.name }}
        @if (picker.activeEffort(); as active) {
          <span class="model-effort">· {{ active }} effort</span>
        }
      </button>
      <div nxaModelPickerContent class="model-content">
        <div nxaModelPickerList aria-label="Models" class="model-list">
          @for (option of picker.filteredModels(); track option.id) {
            <div [nxaModelPickerItem]="option" class="model-item">
              <strong>{{ option.name }}</strong>
              <span>{{ option.description }}</span>
            </div>
          }
        </div>
        @if (picker.efforts(); as efforts) {
          <div nxaModelPickerEffort aria-label="Reasoning effort" class="model-efforts">
            @for (level of efforts; track level.id) {
              <button [nxaModelPickerEffortItem]="level.id" class="model-effort-item">
                {{ level.name }}
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class ModelPicker {
  protected readonly models = MODELS;
  protected readonly model = signal<string | undefined>('echo');
  protected readonly effort = signal<string | undefined>(undefined);
}
