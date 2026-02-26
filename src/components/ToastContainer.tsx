import React from 'react'
import { usePresentationStore } from '../store'
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react'

const ToastContainer: React.FC = () => {
    const { toasts, removeToast } = usePresentationStore()

    if (toasts.length === 0) return null

    return (
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
            {toasts.map(toast => {
                const Icon = toast.type === 'error' ? AlertCircle : toast.type === 'success' ? CheckCircle : Info
                const colorClass =
                    toast.type === 'error' ? 'bg-red-500 text-white' :
                        toast.type === 'success' ? 'bg-emerald-500 text-white' :
                            'bg-blue-500 text-white'

                return (
                    <div
                        key={toast.id}
                        className={`flex items-center gap-3 px-4 py-3 rounded shadow-lg pointer-events-auto transition-all transform origin-bottom translate-y-0 opacity-100 min-w-[250px] max-w-[400px] ${colorClass}`}
                    >
                        <Icon size={20} className="flex-shrink-0" />
                        <p className="text-sm font-medium flex-1 break-words">{toast.message}</p>
                        <button
                            onClick={() => removeToast(toast.id)}
                            className="p-1 hover:bg-black/20 rounded transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                )
            })}
        </div>
    )
}

export default ToastContainer
