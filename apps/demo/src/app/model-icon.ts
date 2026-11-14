import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ModelOption } from '@ngx-assistant/angular';
import { isMonochromeIcon } from './provider-icons';

/**
 * The icon of a model in the model selector, given to it as its `nxaModelSelectorIcon` template: a
 * colored logo is shown as an image, a one-color logo takes the color of the text.
 */
@Component({
  selector: 'nxa-demo-model-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (icon(); as url) {
      @if (monochrome()) {
        <span
          data-demo="model-icon-mask"
          class="block size-3.5 bg-current"
          [style.mask]="mask()"
          [style.-webkit-mask]="mask()"
        ></span>
      } @else {
        <img [src]="url" alt="" draggable="false" class="size-3.5 object-contain" />
      }
    }
  `,
})
export class ModelIcon {
  readonly model = input.required<ModelOption>();

  protected readonly icon = computed(() => this.model().icon);
  protected readonly monochrome = computed(() => isMonochromeIcon(this.icon() ?? ''));
  protected readonly mask = computed(() => `url("${this.icon()}") center / contain no-repeat`);
}
