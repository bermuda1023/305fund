import { useMemo } from 'react';

interface BuildingUnit {
  id: number;
  floor: number;
  unit_letter: string;
  unit_number: string;
  is_fund_owned: boolean;
  consensus_status: string;
  listing_agreement: string;
}

interface BuildingGridProps {
  units: BuildingUnit[];
  onUnitClick?: (unit: BuildingUnit) => void;
}

function getUnitClass(unit: BuildingUnit): string {
  if (unit.is_fund_owned) return 'owned';
  if (unit.consensus_status === 'signed' && unit.listing_agreement === 'signed') return 'signed';
  if (unit.consensus_status === 'unsigned' || unit.listing_agreement === 'unsigned') return 'unsigned';
  return 'unknown';
}

const STANDARD_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R'];

export default function BuildingGrid({ units, onUnitClick }: BuildingGridProps) {
  const floorMap = useMemo(() => {
    const map = new Map<number, BuildingUnit[]>();
    for (const unit of units) {
      const list = map.get(unit.floor) || [];
      list.push(unit);
      map.set(unit.floor, list);
    }
    // Sort units within each floor by letter
    for (const [floor, floorUnits] of map) {
      floorUnits.sort((a, b) => a.unit_letter.localeCompare(b.unit_letter));
      map.set(floor, floorUnits);
    }
    return map;
  }, [units]);

  const floors = useMemo(() => {
    const uniqueFloors = Array.from(new Set(units.map((u) => Number(u.floor))))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    if (uniqueFloors.length > 0) return uniqueFloors;
    return Array.from({ length: 21 }, (_, i) => 21 - i);
  }, [units]);

  return (
    <div className="building-grid" style={{ gridTemplateColumns: '1fr' }}>
      {/* Column headers */}
      <div className="building-row">
        <div className="floor-label" style={{ width: 35 }}></div>
        {STANDARD_LETTERS.map((letter) => (
          <div
            key={letter}
            style={{
              width: 28,
              textAlign: 'center',
              fontSize: '0.6rem',
              fontWeight: 700,
              color: '#666',
            }}
          >
            {letter}
          </div>
        ))}
      </div>

      {floors.map((floor) => {
        const floorUnits = floorMap.get(floor) || [];
        return (
          <div key={floor} className="building-row">
            <div className="floor-label" style={{ width: 35 }}>{floor}</div>
            {STANDARD_LETTERS.map((letter) => {
              const unit = floorUnits.find((u) => u.unit_letter === letter || u.unit_letter.startsWith(letter));
              if (!unit) {
                return <div key={letter} style={{ width: 28, height: 28 }} />;
              }
              return (
                <div
                  key={unit.id}
                  className={`unit-cell ${getUnitClass(unit)}`}
                  title={`${unit.unit_number} - ${getUnitClass(unit)}`}
                  onClick={() => onUnitClick?.(unit)}
                >
                  {unit.unit_letter.length <= 2 ? unit.unit_letter : unit.unit_letter[0]}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--green)' }} />
          Fund Owned
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: '#93c5fd' }} />
          Signed
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--red)' }} />
          Unsigned
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--text-muted)' }} />
          Unknown
        </div>
      </div>
    </div>
  );
}
