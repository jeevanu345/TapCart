import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'

describe('Card component', () => {
    it('renders Card with children', () => {
        render(<Card data-testid="card">Card content</Card>)
        const card = screen.getByTestId('card')
        expect(card).toBeInTheDocument()
        expect(card).toHaveClass('card')
    })

    it('applies custom className', () => {
        render(<Card className="custom-card" data-testid="card">Content</Card>)
        expect(screen.getByTestId('card')).toHaveClass('custom-card')
    })
})

describe('CardHeader component', () => {
    it('renders header content', () => {
        render(<CardHeader data-testid="header">Header</CardHeader>)
        expect(screen.getByTestId('header')).toBeInTheDocument()
    })
})

describe('CardTitle component', () => {
    it('renders title with correct classes', () => {
        render(<CardTitle data-testid="title">Title</CardTitle>)
        const title = screen.getByTestId('title')
        expect(title).toBeInTheDocument()
        expect(title).toHaveClass('card-title')
    })
})

describe('CardDescription component', () => {
    it('renders description', () => {
        render(<CardDescription data-testid="desc">Description text</CardDescription>)
        expect(screen.getByTestId('desc')).toHaveTextContent('Description text')
    })
})

describe('CardContent component', () => {
    it('renders with card-body class', () => {
        render(<CardContent data-testid="content">Content</CardContent>)
        expect(screen.getByTestId('content')).toHaveClass('card-body')
    })
})

describe('CardFooter component', () => {
    it('renders footer with card-actions', () => {
        render(<CardFooter data-testid="footer">Footer</CardFooter>)
        expect(screen.getByTestId('footer')).toHaveClass('card-actions')
    })
})
