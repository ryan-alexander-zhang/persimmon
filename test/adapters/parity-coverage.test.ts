// Coverage of the Source system read whole-repo by line and mapped onto the source index (40-pack-rewrite.md).
import { describe, expect, it } from 'vitest'
import { mapCoverage, readCoverage } from '../../adapters/parity/coverage.mjs'

const jacoco = `<?xml version="1.0" encoding="UTF-8"?>
<report name="jpetstore">
  <package name="org/mybatis/jpetstore/service">
    <sourcefile name="CatalogService.java">
      <line nr="150" mi="0" ci="4" mb="0" cb="0"/>
      <line nr="152" mi="0" ci="3" mb="1" cb="1"/>
      <line nr="160" mi="5" ci="0" mb="0" cb="0"/>
    </sourcefile>
  </package>
</report>`
const cobertura = `<?xml version="1.0"?>
<coverage line-rate="0.5">
  <sources><source>/work/app/src</source></sources>
  <packages><package name="app"><classes>
    <class name="app.cart" filename="app/cart.py">
      <lines>
        <line number="3" hits="2"/>
        <line number="4" hits="2" branch="true" condition-coverage="50% (1/2)"/>
        <line number="9" hits="0"/>
      </lines>
    </class>
  </classes></package></packages>
</coverage>`
const lcov = ['TN:', 'SF:/work/shop/src/cart.ts', 'DA:10,1', 'DA:11,0', 'BRDA:10,0,0,1', 'BRDA:10,0,1,-', 'end_of_record', ''].join('\n')

describe('readCoverage', () => {
  it('reads JaCoCo by package and source file, instructions as hits, missed and covered branches', () => {
    expect(readCoverage(jacoco)).toEqual({
      'org/mybatis/jpetstore/service/CatalogService.java': { 150: { hits: 4 }, 152: { hits: 3, branches: { covered: 1, total: 2 } }, 160: { hits: 0 } },
    })
  })

  it('reads Cobertura line hits and condition coverage', () => {
    expect(readCoverage(cobertura)).toEqual({ 'app/cart.py': { 3: { hits: 2 }, 4: { hits: 2, branches: { covered: 1, total: 2 } }, 9: { hits: 0 } } })
  })

  it('reads lcov DA and BRDA records, a branch never evaluated (-) as not covered', () => {
    expect(readCoverage(lcov)).toEqual({ '/work/shop/src/cart.ts': { 10: { hits: 1, branches: { covered: 1, total: 2 } }, 11: { hits: 0 } } })
  })

  it('refuses a report of no format it knows', () => {
    expect(() => readCoverage('<testsuites/>')).toThrow(/neither a JaCoCo, a Cobertura nor an lcov report/)
  })
})

describe('mapCoverage', () => {
  const index = { 'src/main/java/org/mybatis/jpetstore/service/CatalogService.java': {}, 'src/app/cart.py': {}, 'src/cart.ts': {}, 'lib/cart.ts': {} }

  it('maps a report path to the one indexed file it is a suffix of, or that is a suffix of it', () => {
    const { files, unmapped } = mapCoverage({ ...readCoverage(jacoco), ...readCoverage(cobertura) }, index)
    expect(Object.keys(files)).toEqual(['src/main/java/org/mybatis/jpetstore/service/CatalogService.java', 'src/app/cart.py'])
    expect(unmapped).toEqual([])
  })

  it('leaves unmapped a path no indexed file matches, or several do', () => {
    const { files, unmapped } = mapCoverage({ 'cart.ts': { 1: { hits: 1 } }, 'gone/Other.java': { 1: { hits: 1 } }, '/work/shop/src/cart.ts': { 2: { hits: 1 } } }, index)
    expect(unmapped).toEqual(['cart.ts', 'gone/Other.java']) // cart.ts ends two indexed paths; the absolute one ends with exactly src/cart.ts
    expect(files).toEqual({ 'src/cart.ts': { 2: { hits: 1 } } })
  })
})
