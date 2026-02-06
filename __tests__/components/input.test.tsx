import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Input } from '@/components/ui/input'

describe('Input component', () => {
    it('renders correctly', () => {
        render(<Input placeholder="Enter text" />)
        const input = screen.getByPlaceholderText('Enter text')
        expect(input).toBeInTheDocument()
    })

    it('has daisyUI input classes', () => {
        render(<Input data-testid="input" />)
        const input = screen.getByTestId('input')
        expect(input).toHaveClass('input', 'input-bordered')
    })

    it('handles type prop', () => {
        render(<Input type="email" data-testid="email-input" />)
        expect(screen.getByTestId('email-input')).toHaveAttribute('type', 'email')
    })

    it('handles value changes', () => {
        const handleChange = vi.fn()
        render(<Input onChange={handleChange} data-testid="input" />)

        fireEvent.change(screen.getByTestId('input'), { target: { value: 'test' } })
        expect(handleChange).toHaveBeenCalled()
    })

    it('applies custom className', () => {
        render(<Input className="custom-input" data-testid="input" />)
        expect(screen.getByTestId('input')).toHaveClass('custom-input')
    })

    it('supports disabled state', () => {
        render(<Input disabled data-testid="input" />)
        expect(screen.getByTestId('input')).toBeDisabled()
    })

    it('supports required attribute', () => {
        render(<Input required data-testid="input" />)
        expect(screen.getByTestId('input')).toBeRequired()
    })
})
