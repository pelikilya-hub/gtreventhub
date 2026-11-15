import Foundation

struct Member: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let color: String
    var owner: Bool?
}

struct ChatMessage: Codable, Identifiable, Hashable {
    let id: Int
    let member: String
    let kind: String
    let text: String?
    let media: String?
    let ts: Double
}

/// Штрих общего рисунка. Координаты и толщина — в долях от ширины и высоты листа.
struct Stroke: Codable, Identifiable, Hashable {
    var id: String
    var member: String?
    var color: String
    var width: Double
    var points: [[Double]]
}

/// Всё, что присылает сервер: поле `t` говорит, какие остальные заполнены.
struct ServerEvent: Decodable {
    let t: String
    let me: Member?
    let members: [Member]?
    let online: [String]?
    let messages: [ChatMessage]?
    let strokes: [Stroke]?
    let m: ChatMessage?
    let s: Stroke?
    let member: String?
    let id: String?
    let error: String?
}

/// Всё, что отправляет приложение.
struct ClientEvent: Encodable {
    var t: String
    var kind: String?
    var text: String?
    var media: String?
    var s: Stroke?
    var id: String?
}

struct MeReply: Decodable {
    let me: Member
    let members: [Member]
}

struct MediaReply: Decodable {
    let media: String?
    let left: Int?
    let error: String?
}

enum MagicKind: String, CaseIterable, Identifiable {
    case mask, sticker, coloring

    var id: String { rawValue }
    var title: String {
        switch self {
        case .mask: return "Маска"
        case .sticker: return "Стикер"
        case .coloring: return "Раскраска"
        }
    }
}
