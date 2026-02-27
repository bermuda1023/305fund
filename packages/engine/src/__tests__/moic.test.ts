import { calcGPCoinvestMOIC, calcLPMOIC, calcMOIC, calcNetMOIC } from '../moic';

describe('MOIC helpers', () => {
  it('computes base and net MOIC', () => {
    expect(calcMOIC(150, 100)).toBeCloseTo(1.5, 6);
    expect(calcNetMOIC(150, 100, 10)).toBeCloseTo(1.4, 6);
  });

  it('guards divide-by-zero paths', () => {
    expect(calcMOIC(10, 0)).toBe(0);
    expect(calcNetMOIC(10, 0, 1)).toBe(0);
    expect(calcLPMOIC(10, 0)).toBe(0);
    expect(calcGPCoinvestMOIC(10, 0)).toBe(0);
  });
});

