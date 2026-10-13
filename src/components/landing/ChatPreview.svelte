<script lang="ts">
  import { formatMoney } from '../../lib/currency.js';
  import { t } from '../../lib/i18n.svelte.js';
</script>

<!-- Illustrative conversation for the landing page's AI spotlight. -->
<div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-6 shadow-xl shadow-slate-900/5 space-y-3 text-sm" aria-hidden="true">
  <div class="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
    <span class="grid place-items-center w-7 h-7 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600"><i class="ph ph-sparkle"></i></span>
    <p class="font-medium">{t('landing.chatPreview.title')}</p>
  </div>

  <div class="flex justify-end">
    <p class="max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-white">{t('landing.chatPreview.q1')}</p>
  </div>
  <div class="flex">
    <p class="max-w-[85%] rounded-2xl rounded-bl-md bg-slate-100 dark:bg-slate-900 px-4 py-2.5 leading-relaxed">
      {t('landing.chatPreview.a1', { amount: formatMoney(412.8, 'USD'), log: formatMoney(23.5, 'USD') })}
    </p>
  </div>
  <div class="flex justify-end">
    <p class="max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-white">{t('landing.chatPreview.q2')}</p>
  </div>
  <div class="flex">
    <p class="inline-flex items-center gap-2 rounded-full border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <i class="ph ph-check-circle"></i>
      {t('landing.chatPreview.added', { amount: formatMoney(23.5, 'USD') })}
    </p>
  </div>
</div>
