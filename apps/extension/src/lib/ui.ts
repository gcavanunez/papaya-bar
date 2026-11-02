import { cva, type VariantProps } from 'class-variance-authority'

/**
 * Shared button recipe. Use <AppButton> where possible; call `button()` directly for
 * elements that render their own tag (router-link, MenuButton, PopoverButton).
 */
export const button = cva(
	[
		'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors select-none [&_svg]:shrink-0',
		'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
		'disabled:pointer-events-none disabled:opacity-40',
	],
	{
		variants: {
			intent: {
				primary:
					'bg-slate-900 text-white shadow-xs hover:bg-slate-700 dark:bg-white dark:text-black dark:hover:bg-slate-200',
				secondary:
					'dark:border-vercel-accents-2 dark:hover:bg-vercel-accents-1 border border-slate-200 bg-white text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900 dark:bg-black dark:text-slate-200 dark:hover:text-white',
				ghost: 'dark:text-vercel-accents-6 dark:hover:bg-vercel-accents-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:hover:text-white',
				danger: 'bg-red-600 text-white shadow-xs hover:bg-red-500',
				'danger-ghost':
					'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300',
			},
			size: {
				xs: 'h-6 text-xs',
				sm: 'h-7 text-xs',
				md: 'h-8 text-sm',
				lg: 'h-9 text-sm',
			},
			// Padding lives in compound variants so square buttons never inherit it
			square: {
				true: '',
				false: '',
			},
		},
		compoundVariants: [
			{ size: 'xs', square: false, class: 'px-2' },
			{ size: 'sm', square: false, class: 'px-2.5' },
			{ size: 'md', square: false, class: 'px-3' },
			{ size: 'lg', square: false, class: 'px-4' },
			{ size: 'xs', square: true, class: 'w-6' },
			{ size: 'sm', square: true, class: 'w-7' },
			{ size: 'md', square: true, class: 'w-8' },
			{ size: 'lg', square: true, class: 'w-9' },
		],
		defaultVariants: {
			intent: 'secondary',
			size: 'md',
			square: false,
		},
	},
)

export type ButtonVariants = VariantProps<typeof button>
