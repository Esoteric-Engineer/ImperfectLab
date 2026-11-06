import { PROJECTILE_BONES } from '../../core/package/imperfect'
import { NumberInput } from './common'

const ARM = new Set(['clavicle', 'upper_arm', 'upper_twist', 'forearm', 'forearm_twist', 'hand'])
const BONE_GROUPS: [string, (bone: string) => boolean][] = [
  ['Torso', (b) => !b.includes('.')],
  ['Right arm', (b) => b.startsWith('R.') && ARM.has(b.slice(2))],
  ['Left arm', (b) => b.startsWith('L.') && ARM.has(b.slice(2))],
  ['Right leg', (b) => b.startsWith('R.') && !ARM.has(b.slice(2))],
  ['Left leg', (b) => b.startsWith('L.') && !ARM.has(b.slice(2))],
]

// 'R.upper_twist' -> 'Right upper arm twist'
function boneLabel(bone: string): string {
  const [side, part] = bone.includes('.') ? bone.split('.') : ['', bone]
  const name = part === 'upper_twist' ? 'upper arm twist' : part.replace('_', ' ')
  return side ? `${side === 'R' ? 'Right' : 'Left'} ${name}` : name[0].toUpperCase() + name.slice(1)
}

const AXES: string[] = ['X (side)', 'Y (forward)', 'Z (up)']

// A spot's bone (PROJECTILE_BONES), grouped by limb.
export function BoneSelect({ value, onChange }: { value: string; onChange: (bone: string) => void }) {
  return (
    <select value={value} onChange={(ev) => onChange(ev.target.value)}>
      {BONE_GROUPS.map(([group, has]) => (
        <optgroup key={group} label={group}>
          {PROJECTILE_BONES.filter(has).map((b) => <option key={b} value={b}>{boneLabel(b)}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

// A spot's offset from its bone, in meters on each axis.
export function PositionTable({ value, range, onChange }: { value: [number, number, number]; range: [number, number]; onChange: (axis: number, v: number) => void }) {
  return (
    <table className="gameplay grid">
      <thead><tr><th>Axis</th><th>Position</th></tr></thead>
      <tbody>
        {AXES.map((axis, k) => (
          <tr key={axis}>
            <td>{axis}</td>
            <td><span><NumberInput min={range[0]} max={range[1]} step={0.005} value={value[k]} onChange={(v) => onChange(k, v)} /> m</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}