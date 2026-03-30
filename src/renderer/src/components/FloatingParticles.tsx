import { useMemo } from 'react'

const PARTICLE_COUNT = 30

interface Particle {
  id: number
  left: number      // % from left
  size: number       // px
  duration: number   // seconds
  delay: number      // seconds
  opacity: number
}

export default function FloatingParticles() {
  const particles = useMemo<Particle[]>(() => {
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 2 + Math.random() * 4,
      duration: 8 + Math.random() * 12,
      delay: Math.random() * -20,
      opacity: 0.15 + Math.random() * 0.35
    }))
  }, [])

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 9999 }}>
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute rounded-full particle-float"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            backgroundColor: '#f97316',
            '--p-opacity': p.opacity,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`
          } as React.CSSProperties}
        />
      ))}
    </div>
  )
}
