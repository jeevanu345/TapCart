import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn utility', () => {
    it('merges class names correctly', () => {
        expect(cn('foo', 'bar')).toBe('foo bar')
    })

    it('handles conditional classes', () => {
        expect(cn('base', true && 'active', false && 'hidden')).toBe('base active')
    })

    it('merges tailwind classes correctly', () => {
        expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
    })

    it('handles arrays', () => {
        expect(cn(['foo', 'bar'])).toBe('foo bar')
    })

    it('handles undefined and null', () => {
        expect(cn('foo', undefined, null, 'bar')).toBe('foo bar')
    })

    it('handles empty inputs', () => {
        expect(cn()).toBe('')
    })
})
