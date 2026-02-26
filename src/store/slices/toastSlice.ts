import { StoreSlice, ToastSlice } from '../types'

export const createToastSlice: StoreSlice<ToastSlice> = (set) => ({
    toasts: [],

    addToast: (message, type = 'info') => {
        const id = crypto.randomUUID()
        set((state) => ({
            toasts: [...state.toasts, { id, message, type }]
        }))

        // Auto remove after 3 seconds
        setTimeout(() => {
            set((state) => ({
                toasts: state.toasts.filter(t => t.id !== id)
            }))
        }, 3000)
    },

    removeToast: (id) => {
        set((state) => ({
            toasts: state.toasts.filter(t => t.id !== id)
        }))
    }
})
