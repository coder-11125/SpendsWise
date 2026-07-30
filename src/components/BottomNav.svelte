<script lang="ts">
  import { getIsLoggedIn, navigate } from '../lib/state.svelte.js';

  let { activeFilter = 'dashboard' } = $props();

  let isLoggedIn = $derived(getIsLoggedIn());

  const navItems = [
    { filter: 'dashboard', icon: 'ph-chart-pie-slice', label: 'Dashboard' },
    { filter: 'income', icon: 'ph-trend-up', label: 'Income' },
    { filter: 'expense', icon: 'ph-trend-down', label: 'Expense' },
    { filter: 'ai', icon: 'ph-chat-circle-dots', label: 'AI' },
    { filter: 'account', icon: 'ph-user', label: 'Account' },
  ];

  function handleNav(filter: string) {
    navigate('/' + filter);
  }
</script>

<nav class="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 safe-area-bottom lg:hidden">
  {#each navItems as item}
    <button
      onclick={() => handleNav(item.filter)}
      class="flex flex-col items-center gap-0.5 py-2 px-3 min-w-0 transition-colors cursor-pointer {activeFilter === item.filter ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}"
    >
      <i class="ph {item.icon} text-xl"></i>
      <span class="text-[10px] font-medium leading-tight truncate max-w-full">{item.label}</span>
    </button>
  {/each}
</nav>

<style>
  .safe-area-bottom {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
</style>
