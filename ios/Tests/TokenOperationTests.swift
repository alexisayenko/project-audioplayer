import XCTest
@testable import AudioPlayer

final class TokenOperationTests: XCTestCase {
    private let sep = " - "

    private func parts(_ s: String) -> [String] {
        Tokens.tokenize(s).map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    func testSplitsOnlyOnASpacedDash() {
        XCTAssertEqual(parts("De Hofnar - Zonnestraal"), ["De Hofnar", "Zonnestraal"])
        XCTAssertEqual(parts("A \u{2013} B \u{2014} C"), ["A", "B", "C"])
        XCTAssertEqual(parts("A  -  B"), ["A", "B"])
    }

    func testCommasSemicolonsAmpersandsAndUnspacedSeparatorsNeverSplit() {
        for s in ["Tyler, The Creator", "Earth, Wind & Fire", "A; B", "AC/DC", "24/7", "A|B", "A/ B", "A /B", "A feat. B", "A x B", "Dr. Dre", "Jean-Michel Jarre", "A -B", "A- B", "A\u{2013}B"] {
            XCTAssertEqual(parts(s), [s], s)
        }
    }

    func testThreeTokensEdgesAndEmpty() {
        XCTAssertEqual(parts("A - B - C"), ["A", "B", "C"])
        XCTAssertEqual(parts(" - A - "), ["A"])
        XCTAssertEqual(parts("A - "), ["A"])
        XCTAssertEqual(parts(""), [])
    }

    func testRoundTripLeavesEveryStringUntouched() {
        for s in ["A, B", "A \u{2013} B", "A  -  B", " - A - ", "A - ", "", "Artist | Title", "A \u{FF0F}\u{FF0F} B"] {
            XCTAssertEqual(Tokens.compose(Tokens.tokenize(s)), s, s)
        }
        XCTAssertEqual(Tokens.stripEdges("A \u{2013} B"), "A \u{2013} B")
        XCTAssertEqual(Tokens.stripEdges("Mix - "), "Mix")
        XCTAssertEqual(Tokens.stripEdges("| A |"), "| A |")
    }

    func testRemoveToken() {
        XCTAssertEqual(Tokens.removeToken("A - B - C", 0), "B - C")
        XCTAssertEqual(Tokens.removeToken("A - B - C", 1), "A - C")
        XCTAssertEqual(Tokens.removeToken("A - B - C", 2), "A - B")
        XCTAssertEqual(Tokens.removeToken("A, B", 0), "")
        XCTAssertEqual(Tokens.removeToken("Solo", 0), "")
        XCTAssertEqual(Tokens.removeToken("A - B - C", 9), "A - B - C")
    }

    func testReplaceTokenKeepsSeparators() {
        XCTAssertEqual(Tokens.replaceToken("A \u{2013} B", 1, "X"), "A \u{2013} X")
        XCTAssertEqual(Tokens.replaceToken("A - B", 0, ""), "B")
        XCTAssertEqual(Tokens.replaceToken("Tyler, The Creator", 0, "Tyler, The Creator!"), "Tyler, The Creator!")
    }

    func testAppendTokenJoinsWithTheSeparator() {
        XCTAssertEqual(Tokens.appendToken("", "A", sep), "A")
        XCTAssertEqual(Tokens.appendToken("A", "B", sep), "A - B")
        XCTAssertEqual(Tokens.appendToken("A, B", "C", sep), "A, B - C")
        XCTAssertEqual(Tokens.appendToken("A - ", "B", sep), "A - B")
        XCTAssertEqual(Tokens.appendToken("A", "  ", sep), "A")
        XCTAssertTrue(Tokens.endsWithSeparator("A - "))
        XCTAssertFalse(Tokens.endsWithSeparator("A, "))
    }

    func testMoveTokenBetweenFields() {
        let moved = Tokens.moveToken("De Hofnar - Zonnestraal", 0, "KAV", sep)
        XCTAssertEqual(moved.src, "Zonnestraal")
        XCTAssertEqual(moved.dst, "KAV - De Hofnar")
        let solo = Tokens.moveToken("Solo", 0, "", sep)
        XCTAssertEqual(solo.src, "")
        XCTAssertEqual(solo.dst, "Solo")
        let blank = Tokens.moveToken("A - ", 1, "X", sep)
        XCTAssertEqual(blank.src, "A - ")
        XCTAssertEqual(blank.dst, "X")
    }

    func testCommitTypedNeedsTheExactSeparator() {
        XCTAssertTrue(Tokens.commitTyped("", "A, B", sep) == ("", "A, B"))
        XCTAssertTrue(Tokens.commitTyped("", "A; B & C", sep) == ("", "A; B & C"))
        XCTAssertTrue(Tokens.commitTyped("", "A - Bo", sep) == ("A - ", "Bo"))
        XCTAssertEqual(Tokens.stripEdges(Tokens.commitTyped("X", "A - ", sep).value), "X - A")
    }

    func testInsertTokenAndMoveTokenTo() {
        XCTAssertEqual(Tokens.insertToken("A - C", at: 1, token: "B", defaultSep: sep), "A - B - C")
        XCTAssertEqual(Tokens.insertToken("", at: 0, token: "Foo", defaultSep: sep), "Foo")
        XCTAssertEqual(Tokens.insertToken("A - B", at: 99, token: "Foo", defaultSep: sep), "A - B - Foo")
        XCTAssertEqual(Tokens.insertToken("A", at: 0, token: "  ", defaultSep: sep), "A")
        let same = Tokens.moveTokenTo(src: "A - B - C", index: 0, dst: "A - B - C", dstIndex: 3, dstDefaultSep: sep, sameField: true)
        XCTAssertEqual(same.src, "B - C - A")
        XCTAssertEqual(same.dst, "B - C - A")
        let across = Tokens.moveTokenTo(src: "A - B", index: 0, dst: "X", dstIndex: 1, dstDefaultSep: sep, sameField: false)
        XCTAssertEqual(across.src, "B")
        XCTAssertEqual(across.dst, "X - A")
        let noop = Tokens.moveTokenTo(src: "A - B - C", index: 1, dst: "A - B - C", dstIndex: 2, dstDefaultSep: sep, sameField: true)
        XCTAssertEqual(noop.src, "A - B - C")
    }

    func testSpacedSlashAndPipeSeparateAndUnspacedNeverDo() {
        let table: [(String, [String])] = [
            ("A / B", ["A", "B"]), ("A // B", ["A", "B"]), ("A | B", ["A", "B"]),
            ("A \u{FF0F} B", ["A", "B"]), ("A \u{FF5C} B", ["A", "B"]), ("A \u{FF0F}\u{FF0F} B", ["A", "B"]),
            ("AC/DC - Back In Black", ["AC/DC", "Back In Black"]), ("A - B / C | D", ["A", "B", "C", "D"]),
            ("A /// B", ["A /// B"]), ("A / ", ["A"]), ("24/7 | X", ["24/7", "X"]), ("Artist | Title", ["Artist", "Title"]),
        ]
        for (s, want) in table { XCTAssertEqual(parts(s), want, s) }
    }

    func testAStoredPipeStringIsKeptVerbatimUntilEdited() {
        let s = "Artist | Title"
        XCTAssertEqual(Tokens.stripEdges(s), s)
        XCTAssertEqual(Tokens.replaceToken(s, 1, "Other"), "Artist | Other")
        XCTAssertEqual(Tokens.appendToken(s, "C", sep), "Artist | Title - C")
    }
}
