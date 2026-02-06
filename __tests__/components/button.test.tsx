import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '@/components/ui/button'

describe('Button component', () => {
    it('renders with default variant', () => {
        render(<Button>Click me</Button>)
        const button = screen.getByRole('button', { name: /click me/i })
        expect(button).toBeInTheDocument()
        expect(button).toHaveClass('btn', 'btn-primary')
    })

    it('renders with secondary variant', () => {
        render(<Button variant="secondary">Secondary</Button>)
        const button = screen.getByRole('button', { name: /secondary/i })
        expect(button).toHaveClass('btn', 'btn-secondary')
    })

    it('renders with destructive variant', () => {
        render(<Button variant="destructive">Delete</Button>)
        const button = screen.getByRole('button', { name: /delete/i })
        expect(button).toHaveClass('btn', 'btn-error')
    })

    it('renders with outline variant', () => {
        render(<Button variant="outline">Outline</Button>)
        const button = screen.getByRole('button', { name: /outline/i })
        expect(button).toHaveClass('btn', 'btn-outline')
    })

    it('renders with different sizes', () => {
        const { rerender } = render(<Button size="sm">Small</Button>)
        expect(screen.getByRole('button')).toHaveClass('btn-sm')

        rerender(<Button size="lg">Large</Button>)
        expect(screen.getByRole('button')).toHaveClass('btn-lg')
    })

    it('handles click events', () => {
        const handleClick = vi.fn()
        render(<Button onClick={handleClick}>Click me</Button>)

        fireEvent.click(screen.getByRole('button'))
        expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('supports disabled state', () => {
        render(<Button disabled>Disabled</Button>)
        const button = screen.getByRole('button')
        expect(button).toBeDisabled()
    })

    it('applies custom className', () => {
        render(<Button className="custom-class">Custom</Button>)
        expect(screen.getByRole('button')).toHaveClass('custom-class')
    })
})
