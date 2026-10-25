// script-ocr: reads the text of scanned script pages with macOS's own text recognition
// (Vision), for File → Import Script (main/script.js). Built by scripts/build-ocr.js.
//
//   script-ocr <pdf> <pages>      pages: "2,3,7-12"
//
// Prints one JSON object per page as it's done:
//   {"page": 3, "width": 612, "height": 792, "lines": [{"x", "y", "width", "height", "text"}]}
// in PDF points from the page's top-left corner, as it's shown (crop box, rotation applied):
// the same coordinates pdf.js gives the app.

import Foundation
import PDFKit
import Vision

func pages(_ spec: String, count: Int) -> [Int] {
	var list: [Int] = []
	for part in spec.split(separator: ",") {
		let ends = part.split(separator: "-").compactMap { Int($0) }
		if ends.count == 2 { list += Array(ends[0]...ends[1]) } else if let n = ends.first { list.append(n) }
	}
	return list.filter { $0 >= 1 && $0 <= count }
}

let args = CommandLine.arguments
guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
	FileHandle.standardError.write("usage: script-ocr <pdf> <pages>\n".data(using: .utf8)!)
	exit(1)
}

// Rendered at this many pixels per point: enough for small script type
let scale: CGFloat = 2.5

for n in pages(args[2], count: doc.pageCount) {
	autoreleasepool {
		guard let page = doc.page(at: n - 1) else { return }
		let box = page.bounds(for: .cropBox)
		let rotated = page.rotation % 180 != 0
		let width = rotated ? box.height : box.width, height = rotated ? box.width : box.height
		let image = page.thumbnail(of: CGSize(width: width * scale, height: height * scale), for: .cropBox)
		var lines: [[String: Any]] = []
		if let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
			let request = VNRecognizeTextRequest()
			request.recognitionLevel = .accurate
			request.usesLanguageCorrection = true
			try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
			for observation in request.results ?? [] {
				guard let text = observation.topCandidates(1).first?.string else { continue }
				let b = observation.boundingBox   // 0-1, bottom-left origin
				lines.append(["x": b.minX * width, "y": (1 - b.maxY) * height, "width": b.width * width, "height": b.height * height, "text": text])
			}
		}
		let result: [String: Any] = ["page": n, "width": width, "height": height, "lines": lines]
		if let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) {
			print(json)
			fflush(stdout)
		}
	}
}
