import XCTest

private final class BundleAnchor {}

private struct SimNode: Decodable { let id: String; let r: Double }
private struct SimLink: Decodable { let source: String; let target: String; let related: Bool }
private struct Point: Decodable { let id: String; let x: Double; let y: Double }
private struct Settled: Decodable { let ticks: Int; let positions: [Point] }
private struct RNGCase: Decodable { let seed: UInt32; let values: [Double] }

private struct SimCases: Decodable {
    let rng: RNGCase
    let nodes: [SimNode]
    let links: [SimLink]
    let seed: UInt32
    let settled: [Settled]
}

final class GenSimCasesTests: XCTestCase {
    private func cases() throws -> SimCases {
        let url = try XCTUnwrap(Bundle(for: BundleAnchor.self).url(forResource: "gen_sim_cases", withExtension: "json"))
        return try JSONDecoder().decode(SimCases.self, from: Data(contentsOf: url))
    }

    private func bodies(_ all: SimCases) -> [GenBody] {
        all.nodes.map { n in
            let node = GenNode(id: n.id, label: n.id, qid: nil, wikipedia: nil, family: "Other", style: nil, count: 0, ownCount: 0, parents: [], tags: [])
            let body = GenBody(data: node)
            body.r = n.r
            return body
        }
    }

    func testTheRandomSequenceMatchesMulberry32() throws {
        let c = try cases().rng
        var rng = GenRNG(a: c.seed)
        for want in c.values { XCTAssertEqual(rng.next(), want, accuracy: 1e-15) }
    }

    func testSettledPositionsMatchTheWebSimulation() throws {
        let all = try cases()
        for run in all.settled {
            let list = bodies(all)
            let edges = all.links.map { GenEdge(source: $0.source, target: $0.target, related: $0.related) }
            let sim = GenSim(bodies: list, edges: edges, seed: all.seed, breathing: false)
            sim.settle(run.ticks)
            for p in run.positions {
                let body = try XCTUnwrap(list.first { $0.id == p.id })
                XCTAssertEqual(body.x, p.x, accuracy: 1e-6, "\(p.id) x after \(run.ticks)")
                XCTAssertEqual(body.y, p.y, accuracy: 1e-6, "\(p.id) y after \(run.ticks)")
            }
        }
    }
}
