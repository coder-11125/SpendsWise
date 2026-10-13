<script lang="ts">
  import { getIsLoggedIn, navigate, dashboardPath } from '../lib/state.svelte.js';
  import { formatMoney } from '../lib/currency.js';
  import { t, locales, getLocale, setLocale } from '../lib/i18n.svelte.js';
  import HubPreview from '../components/landing/HubPreview.svelte';
  import ChatPreview from '../components/landing/ChatPreview.svelte';
  import SummaryPreview from '../components/landing/SummaryPreview.svelte';

  let isLoggedIn = $derived(getIsLoggedIn());
  let locale = $derived(getLocale());
  const year = new Date().getFullYear();

  let navLinks = $derived([
    { id: 'how', label: t('landing.nav.how') },
    { id: 'features', label: t('landing.nav.features') },
    { id: 'security', label: t('landing.nav.security') },
    { id: 'faq', label: t('landing.nav.faq') },
  ]);

  let steps = $derived([
    { n: '01', title: t('landing.how.1.title'), body: t('landing.how.1.body') },
    { n: '02', title: t('landing.how.2.title'), body: t('landing.how.2.body') },
    { n: '03', title: t('landing.how.3.title'), body: t('landing.how.3.body') },
  ]);

  // Each spotlight pairs copy with a markup-drawn preview, alternating sides.
  let spotlights = $derived([
    { key: 'hubs', icon: 'ph-users-three', preview: HubPreview },
    { key: 'ai', icon: 'ph-sparkle', preview: ChatPreview },
    { key: 'summaries', icon: 'ph-newspaper', preview: SummaryPreview },
  ].map(sp => ({
    ...sp,
    eyebrow: t(`landing.spot.${sp.key}.eyebrow`),
    title: t(`landing.spot.${sp.key}.title`),
    body: t(`landing.spot.${sp.key}.body`),
    points: [1, 2, 3].map(i => t(`landing.spot.${sp.key}.point${i}`)),
  })));

  let essentials = $derived([
    { icon: 'ph-lightning', title: t('landing.feature.tracking.title'), body: t('landing.feature.tracking.body') },
    { icon: 'ph-repeat', title: t('landing.feature.recurring.title'), body: t('landing.feature.recurring.body') },
    { icon: 'ph-target', title: t('landing.feature.budgets.title'), body: t('landing.feature.budgets.body') },
    { icon: 'ph-globe-hemisphere-west', title: t('landing.feature.currency.title'), body: t('landing.feature.currency.body') },
    { icon: 'ph-arrows-clockwise', title: t('landing.feature.sync.title'), body: t('landing.feature.sync.body') },
    { icon: 'ph-devices', title: t('landing.feature.devices.title'), body: t('landing.feature.devices.body') },
  ]);

  let security = $derived([
    { icon: 'ph-cookie', title: t('landing.security.sessions.title'), body: t('landing.security.sessions.body') },
    { icon: 'ph-lock-key', title: t('landing.security.passwords.title'), body: t('landing.security.passwords.body') },
    { icon: 'ph-database', title: t('landing.security.hubs.title'), body: t('landing.security.hubs.body') },
    { icon: 'ph-export', title: t('landing.security.portable.title'), body: t('landing.security.portable.body') },
  ]);

  let faqs = $derived([1, 2, 3, 4, 5, 6].map(i => ({ q: t(`landing.faq.${i}.q`), a: t(`landing.faq.${i}.a`) })));

  // Illustrative entries for the product preview card.
  let previewRows = $derived([
    { icon: 'ph-briefcase', label: t('landing.preview.salary'), meta: t('landing.preview.recurring'), amount: 4200, income: true },
    { icon: 'ph-shopping-cart', label: t('landing.preview.groceries'), meta: t('landing.preview.sharedBy', { name: 'Sam' }), amount: 86.4, income: false },
    { icon: 'ph-house', label: t('landing.preview.rent'), meta: t('landing.preview.recurring'), amount: 1350, income: false },
  ]);

  // Real links so they work with middle-click / copy-link, routed in-app.
  function go(e: MouseEvent, path: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(path);
  }

  // In-page section links scroll the landing container without touching the URL.
  function jump(e: MouseEvent, id: string) {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<div class="h-screen overflow-y-auto bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 selection:bg-blue-100 dark:selection:bg-blue-900/60">
  <header class="sticky top-0 z-30 border-b border-slate-100 dark:border-slate-900 bg-white/80 dark:bg-slate-950/80 backdrop-blur">
    <nav class="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
      <a href="/" onclick={(e) => go(e, '/')} class="flex items-center gap-2.5 font-semibold tracking-tight">
        <span class="grid place-items-center w-8 h-8 rounded-lg bg-blue-600 text-white">
          <i class="ph ph-wallet text-lg"></i>
        </span>
        SpendsWise
      </a>

      <div class="hidden md:flex items-center gap-7 text-sm text-slate-500 dark:text-slate-400">
        {#each navLinks as l (l.id)}
          <a href="#{l.id}" onclick={(e) => jump(e, l.id)} class="hover:text-slate-900 dark:hover:text-white transition-colors">{l.label}</a>
        {/each}
      </div>

      <div class="flex items-center gap-1 sm:gap-3">
        <label class="hidden lg:flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          <i class="ph ph-translate"></i>
          <select value={locale} aria-label={t('common.language')}
            onchange={(e) => setLocale((e.target as HTMLSelectElement).value as 'en' | 'es')}
            class="bg-transparent pr-1 text-sm text-slate-600 dark:text-slate-300 focus:outline-none cursor-pointer">
            {#each locales as l (l.code)}
              <option value={l.code}>{l.label}</option>
            {/each}
          </select>
        </label>

        {#if isLoggedIn}
          <a href={dashboardPath()} onclick={(e) => go(e, dashboardPath())}
            class="inline-flex items-center gap-1.5 rounded-full bg-slate-900 dark:bg-white px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-200 transition-colors">
            {t('landing.openDashboard')}
            <i class="ph ph-arrow-right"></i>
          </a>
        {:else}
          <a href="/login" onclick={(e) => go(e, '/login')}
            class="px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
            {t('login.signIn')}
          </a>
          <a href="/login" onclick={(e) => go(e, '/login')}
            class="rounded-full bg-slate-900 dark:bg-white px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-200 transition-colors">
            {t('landing.getStarted')}
          </a>
        {/if}
      </div>
    </nav>
  </header>

  <main>
    <section class="mx-auto max-w-6xl px-4 sm:px-6 pt-20 sm:pt-28 text-center animate-fade-in">
      <p class="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-800 px-3 py-1 text-xs font-medium text-slate-500 dark:text-slate-400">
        <span class="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
        {t('landing.eyebrow')}
      </p>
      <h1 class="mx-auto mt-6 max-w-4xl text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05] text-balance">
        {t('landing.headline')}
        <span class="block text-slate-400 dark:text-slate-500">{t('landing.headlineSub')}</span>
      </h1>
      <p class="mx-auto mt-6 max-w-xl text-base sm:text-lg text-slate-500 dark:text-slate-400 leading-relaxed">
        {t('landing.lede')}
      </p>
      <div class="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
        {#if isLoggedIn}
          <a href={dashboardPath()} onclick={(e) => go(e, dashboardPath())}
            class="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 transition-colors">
            {t('landing.openDashboard')}
            <i class="ph ph-arrow-right"></i>
          </a>
        {:else}
          <a href="/login" onclick={(e) => go(e, '/login')}
            class="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 transition-colors">
            {t('landing.getStarted')}
            <i class="ph ph-arrow-right"></i>
          </a>
          <a href="/login" onclick={(e) => go(e, '/login')}
            class="rounded-full px-6 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
            {t('landing.haveAccount')}
          </a>
        {/if}
      </div>

      <!-- Product preview, drawn in markup rather than a screenshot -->
      <div class="mx-auto mt-16 sm:mt-20 max-w-4xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-2 shadow-2xl shadow-slate-900/5 text-left" aria-hidden="true">
        <div class="rounded-xl bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 p-5 sm:p-8">
          <div class="flex items-center justify-between">
            <p class="text-sm font-medium">{t('landing.preview.thisMonth')}</p>
            <div class="flex gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-slate-200 dark:bg-slate-800"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-slate-200 dark:bg-slate-800"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-slate-200 dark:bg-slate-800"></span>
            </div>
          </div>

          <div class="mt-6 grid grid-cols-3 gap-3 sm:gap-6">
            <div>
              <p class="text-[11px] sm:text-xs text-slate-400">{t('landing.preview.income')}</p>
              <p class="mt-1 text-base sm:text-2xl font-semibold tracking-tight text-emerald-600">{formatMoney(4200, 'USD')}</p>
            </div>
            <div>
              <p class="text-[11px] sm:text-xs text-slate-400">{t('landing.preview.expenses')}</p>
              <p class="mt-1 text-base sm:text-2xl font-semibold tracking-tight text-rose-600">{formatMoney(2318.75, 'USD')}</p>
            </div>
            <div>
              <p class="text-[11px] sm:text-xs text-slate-400">{t('landing.preview.balance')}</p>
              <p class="mt-1 text-base sm:text-2xl font-semibold tracking-tight">{formatMoney(1881.25, 'USD')}</p>
            </div>
          </div>

          <svg viewBox="0 0 400 80" preserveAspectRatio="none" class="mt-6 w-full h-16 sm:h-20">
            <defs>
              <linearGradient id="landing-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="#2563eb" stop-opacity="0.18" />
                <stop offset="100%" stop-color="#2563eb" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 62 C 30 58, 50 40, 80 44 S 130 66, 160 52 S 210 18, 250 28 S 310 54, 340 36 S 380 14, 400 18 L 400 80 L 0 80 Z" fill="url(#landing-area)" />
            <path d="M0 62 C 30 58, 50 40, 80 44 S 130 66, 160 52 S 210 18, 250 28 S 310 54, 340 36 S 380 14, 400 18" fill="none" stroke="#2563eb" stroke-width="2" vector-effect="non-scaling-stroke" />
          </svg>

          <ul class="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {#each previewRows as row (row.label)}
              <li class="flex items-center gap-3 py-3">
                <span class="grid place-items-center w-9 h-9 rounded-full {row.income ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400'}">
                  <i class="ph {row.icon}"></i>
                </span>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium truncate">{row.label}</p>
                  <p class="text-xs text-slate-400 truncate">{row.meta}</p>
                </div>
                <p class="text-sm font-medium tabular-nums {row.income ? 'text-emerald-600' : ''}">
                  {row.income ? '+' : '−'}{formatMoney(row.amount, 'USD')}
                </p>
              </li>
            {/each}
          </ul>
        </div>
      </div>
    </section>

    <section id="how" class="scroll-mt-20 mx-auto max-w-6xl px-4 sm:px-6 pt-24 sm:pt-32">
      <div class="max-w-2xl">
        <p class="text-sm font-medium text-blue-600">{t('landing.how.eyebrow')}</p>
        <h2 class="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-balance">{t('landing.how.title')}</h2>
      </div>
      <ol class="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
        {#each steps as step (step.n)}
          <li class="border-t border-slate-200 dark:border-slate-800 pt-6">
            <span class="font-mono text-xs text-slate-400">{step.n}</span>
            <h3 class="mt-3 font-medium">{step.title}</h3>
            <p class="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{step.body}</p>
          </li>
        {/each}
      </ol>
    </section>

    <section id="features" class="scroll-mt-20 mx-auto max-w-6xl px-4 sm:px-6 pt-24 sm:pt-32 space-y-24 sm:space-y-32">
      {#each spotlights as sp, i (sp.key)}
        <div class="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div class={i % 2 === 1 ? 'lg:order-2' : ''}>
            <p class="inline-flex items-center gap-2 text-sm font-medium text-blue-600">
              <i class="ph {sp.icon}"></i>{sp.eyebrow}
            </p>
            <h2 class="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-balance">{sp.title}</h2>
            <p class="mt-4 leading-relaxed text-slate-500 dark:text-slate-400">{sp.body}</p>
            <ul class="mt-6 space-y-3">
              {#each sp.points as point (point)}
                <li class="flex items-start gap-3 text-sm">
                  <i class="ph ph-check mt-0.5 text-blue-600"></i>
                  <span class="text-slate-600 dark:text-slate-300">{point}</span>
                </li>
              {/each}
            </ul>
          </div>
          <div class="{i % 2 === 1 ? 'lg:order-1' : ''} rounded-3xl bg-slate-50 dark:bg-slate-900/60 p-4 sm:p-10">
            <sp.preview />
          </div>
        </div>
      {/each}
    </section>

    <section class="mx-auto max-w-6xl px-4 sm:px-6 pt-24 sm:pt-32">
      <div class="max-w-2xl">
        <h2 class="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">{t('landing.featuresTitle')}</h2>
        <p class="mt-4 text-slate-500 dark:text-slate-400">{t('landing.featuresLede')}</p>
      </div>

      <div class="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-px overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-200 dark:bg-slate-800">
        {#each essentials as f (f.icon)}
          <div class="bg-white dark:bg-slate-950 p-7 sm:p-8">
            <i class="ph {f.icon} text-xl text-blue-600"></i>
            <h3 class="mt-4 font-medium">{f.title}</h3>
            <p class="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{f.body}</p>
          </div>
        {/each}
      </div>
    </section>

    <section id="security" class="scroll-mt-20 mt-24 sm:mt-32 border-y border-slate-100 dark:border-slate-900 bg-slate-50 dark:bg-slate-900/40">
      <div class="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-24 grid gap-12 lg:grid-cols-3">
        <div>
          <p class="inline-flex items-center gap-2 text-sm font-medium text-blue-600"><i class="ph ph-shield-check"></i>{t('landing.security.eyebrow')}</p>
          <h2 class="mt-3 text-3xl font-semibold tracking-tight text-balance">{t('landing.security.title')}</h2>
          <p class="mt-4 leading-relaxed text-slate-500 dark:text-slate-400">{t('landing.security.lede')}</p>
        </div>
        <div class="lg:col-span-2 grid gap-8 sm:grid-cols-2">
          {#each security as item (item.icon)}
            <div class="flex gap-4">
              <span class="grid place-items-center shrink-0 w-10 h-10 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                <i class="ph {item.icon} text-lg"></i>
              </span>
              <div>
                <h3 class="font-medium">{item.title}</h3>
                <p class="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{item.body}</p>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <section id="faq" class="scroll-mt-20 mx-auto max-w-3xl px-4 sm:px-6 py-24 sm:py-32">
      <h2 class="text-3xl sm:text-4xl font-semibold tracking-tight text-center text-balance">{t('landing.faq.title')}</h2>
      <div class="mt-12 divide-y divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
        {#each faqs as f (f.q)}
          <details class="group py-5">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-6 font-medium [&::-webkit-details-marker]:hidden">
              {f.q}
              <i class="ph ph-plus shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-45"></i>
            </summary>
            <p class="mt-3 pr-10 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{f.a}</p>
          </details>
        {/each}
      </div>
    </section>

    <section class="mx-auto max-w-6xl px-4 sm:px-6 pb-24 sm:pb-32">
      <div class="rounded-3xl bg-slate-900 dark:bg-slate-900 px-6 py-16 sm:py-20 text-center">
        <h2 class="mx-auto max-w-xl text-3xl sm:text-4xl font-semibold tracking-tight text-white text-balance">{t('landing.ctaTitle')}</h2>
        <p class="mx-auto mt-4 max-w-md text-slate-400">{t('landing.ctaLede')}</p>
        <a href={isLoggedIn ? dashboardPath() : '/login'} onclick={(e) => go(e, isLoggedIn ? dashboardPath() : '/login')}
          class="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-slate-900 hover:bg-slate-200 transition-colors">
          {isLoggedIn ? t('landing.openDashboard') : t('landing.getStarted')}
          <i class="ph ph-arrow-right"></i>
        </a>
      </div>
    </section>
  </main>

  <footer class="border-t border-slate-100 dark:border-slate-900">
    <div class="mx-auto max-w-6xl px-4 sm:px-6 py-12 grid gap-10 sm:grid-cols-[2fr_1fr_1fr]">
      <div>
        <p class="flex items-center gap-2 font-semibold tracking-tight">
          <span class="grid place-items-center w-7 h-7 rounded-lg bg-blue-600 text-white"><i class="ph ph-wallet"></i></span>
          SpendsWise
        </p>
        <p class="mt-3 max-w-xs text-sm text-slate-500 dark:text-slate-400">{t('landing.footer.tagline')}</p>
        <label class="mt-5 inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          <i class="ph ph-translate"></i>
          <select value={locale} aria-label={t('common.language')}
            onchange={(e) => setLocale((e.target as HTMLSelectElement).value as 'en' | 'es')}
            class="bg-transparent text-sm focus:outline-none cursor-pointer">
            {#each locales as l (l.code)}
              <option value={l.code}>{l.label}</option>
            {/each}
          </select>
        </label>
      </div>
      <div>
        <p class="text-sm font-medium">{t('landing.footer.product')}</p>
        <ul class="mt-3 space-y-2 text-sm text-slate-500 dark:text-slate-400">
          {#each navLinks as l (l.id)}
            <li><a href="#{l.id}" onclick={(e) => jump(e, l.id)} class="hover:text-slate-900 dark:hover:text-white transition-colors">{l.label}</a></li>
          {/each}
        </ul>
      </div>
      <div>
        <p class="text-sm font-medium">{t('landing.footer.account')}</p>
        <ul class="mt-3 space-y-2 text-sm text-slate-500 dark:text-slate-400">
          {#if isLoggedIn}
            <li><a href={dashboardPath()} onclick={(e) => go(e, dashboardPath())} class="hover:text-slate-900 dark:hover:text-white transition-colors">{t('landing.openDashboard')}</a></li>
          {:else}
            <li><a href="/login" onclick={(e) => go(e, '/login')} class="hover:text-slate-900 dark:hover:text-white transition-colors">{t('login.signIn')}</a></li>
            <li><a href="/login" onclick={(e) => go(e, '/login')} class="hover:text-slate-900 dark:hover:text-white transition-colors">{t('landing.getStarted')}</a></li>
          {/if}
        </ul>
      </div>
    </div>
    <div class="border-t border-slate-100 dark:border-slate-900">
      <p class="mx-auto max-w-6xl px-4 sm:px-6 py-6 text-xs text-slate-400">© {year} SpendsWise</p>
    </div>
  </footer>
</div>
