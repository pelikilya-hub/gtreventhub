import Foundation
import Security
import UIKit

/// Код входа хранится в связке ключей, а не в настройках: это единственный секрет приложения.
enum Keychain {
    private static let base: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "moya-raduga",
        kSecAttrAccount as String: "code",
    ]

    static func read() -> String? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String?) {
        SecItemDelete(base as CFDictionary)
        guard let value else { return }
        var query = base
        query[kSecValueData as String] = Data(value.utf8)
        SecItemAdd(query as CFDictionary, nil)
    }
}

enum RadugaError: Error {
    case server(String)
    case network
}

/// Связь с сервером: вход, WebSocket с переподключением, картинки и «чудеса».
@MainActor
final class RadugaClient: ObservableObject {
    enum Status { case loggedOut, connecting, online, offline }

    @Published private(set) var status: Status = .loggedOut
    @Published private(set) var me: Member?
    @Published private(set) var members: [Member] = []
    @Published private(set) var online: Set<String> = []
    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var strokes: [Stroke] = []
    /// Штрихи, которые друзья рисуют прямо сейчас (палец ещё на экране).
    @Published private(set) var live: [String: Stroke] = [:]
    @Published private(set) var typing: [String: Date] = [:]

    private let base: URL
    private var token: String?
    private var task: URLSessionWebSocketTask?
    private var attempt = 0
    private var pinger: Task<Void, Never>?
    private let cache = NSCache<NSString, UIImage>()

    init() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "RadugaServer") as? String
        base = URL(string: configured ?? "") ?? URL(string: "https://example.invalid")!
        if let saved = Keychain.read() {
            token = saved
            status = .connecting
            connect()
        }
    }

    func member(_ id: String?) -> Member? {
        members.first { $0.id == id }
    }

    // MARK: Вход

    /// Возвращает текст ошибки для ребёнка или nil, если вошли.
    func login(code raw: String) async -> String? {
        let code = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !code.isEmpty else { return "Введи свой код" }
        var request = URLRequest(url: base.appending(path: "me"))
        request.setValue("Bearer \(code)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return "Код не подошёл. Проверь буквы" }
            let reply = try JSONDecoder().decode(MeReply.self, from: data)
            token = code
            Keychain.write(code)
            me = reply.me
            members = reply.members
            status = .connecting
            connect()
            return nil
        } catch {
            return "Нет связи. Попробуй ещё раз"
        }
    }

    func logout() {
        Keychain.write(nil)
        token = nil
        closeSocket()
        me = nil
        messages = []
        strokes = []
        live = [:]
        online = []
        status = .loggedOut
    }

    // MARK: WebSocket

    /// Зовётся и при возвращении приложения на экран.
    func connect() {
        guard let token, task == nil else { return }
        guard var parts = URLComponents(url: base.appending(path: "ws"), resolvingAgainstBaseURL: false) else { return }
        parts.scheme = parts.scheme == "http" ? "ws" : "wss"
        parts.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = parts.url else { return }
        let socket = URLSession.shared.webSocketTask(with: url)
        task = socket
        socket.resume()
        listen(socket)
        pinger = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(25))
                self?.send(ClientEvent(t: "ping"))
            }
        }
    }

    private func listen(_ socket: URLSessionWebSocketTask) {
        socket.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.task === socket else { return }
                switch result {
                case .success(.string(let text)):
                    self.handle(text)
                    self.listen(socket)
                case .success:
                    self.listen(socket)
                case .failure:
                    self.dropped()
                }
            }
        }
    }

    private func closeSocket() {
        pinger?.cancel()
        pinger = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func dropped() {
        closeSocket()
        guard token != nil else { return }
        status = .offline
        attempt += 1
        let delay = min(pow(2, Double(attempt - 1)), 15)
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            self?.connect()
        }
    }

    private func send(_ event: ClientEvent) {
        guard let task, let data = try? JSONEncoder().encode(event), let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    private func handle(_ text: String) {
        guard let event = try? JSONDecoder().decode(ServerEvent.self, from: Data(text.utf8)) else { return }
        switch event.t {
        case "hello":
            attempt = 0
            me = event.me
            members = event.members ?? []
            online = Set(event.online ?? [])
            messages = event.messages ?? []
            strokes = event.strokes ?? []
            live = [:]
            status = .online
        case "presence":
            online = Set(event.online ?? [])
        case "msg":
            guard let message = event.m, !messages.contains(where: { $0.id == message.id }) else { return }
            messages.append(message)
            typing[message.member] = nil
        case "typing":
            if let id = event.member { typing[id] = Date() }
        case "draw":
            if let stroke = event.s { live[stroke.id] = stroke }
        case "stroke":
            guard let stroke = event.s else { return }
            live[stroke.id] = nil
            strokes.removeAll { $0.id == stroke.id }
            strokes.append(stroke)
        case "undo":
            // Сервер удаляет только штрих автора — повторяем то же условие.
            if let id = event.id { strokes.removeAll { $0.id == id && $0.member == event.member } }
        case "clear":
            strokes = []
            live = [:]
        default:
            break
        }
    }

    // MARK: Чат

    func sendText(_ text: String) {
        send(ClientEvent(t: "msg", kind: "text", text: text))
    }

    func sendMedia(_ media: String, kind: String, text: String? = nil) {
        send(ClientEvent(t: "msg", kind: kind, text: text, media: media))
    }

    func sendTyping() {
        send(ClientEvent(t: "typing"))
    }

    // MARK: Рисунок

    func sendDraw(_ stroke: Stroke) {
        send(ClientEvent(t: "draw", s: stroke))
    }

    func commit(_ stroke: Stroke) {
        strokes.append(stroke)
        send(ClientEvent(t: "stroke", s: stroke))
    }

    func undoLast() {
        guard let mine = strokes.last(where: { $0.member == me?.id }) else { return }
        send(ClientEvent(t: "undo", id: mine.id))
    }

    func clearBoard() {
        send(ClientEvent(t: "clear"))
    }

    // MARK: Картинки

    private func authorized(_ path: String, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: base.appending(path: path))
        request.httpMethod = method
        request.setValue("Bearer \(token ?? "")", forHTTPHeaderField: "Authorization")
        return request
    }

    private func mediaReply(_ request: URLRequest, body: Data) async throws -> MediaReply {
        guard let (data, _) = try? await URLSession.shared.upload(for: request, from: body) else { throw RadugaError.network }
        guard let reply = try? JSONDecoder().decode(MediaReply.self, from: data) else { throw RadugaError.network }
        if let error = reply.error { throw RadugaError.server(error) }
        return reply
    }

    func upload(_ data: Data, mime: String) async throws -> String {
        var request = authorized("upload", method: "POST")
        request.setValue(mime, forHTTPHeaderField: "Content-Type")
        guard let media = try await mediaReply(request, body: data).media else { throw RadugaError.network }
        return media
    }

    /// Просит сервер наколдовать картинку. Возвращает ключ картинки и сколько чудес осталось.
    func magic(kind: MagicKind, prompt: String) async throws -> (media: String, left: Int?) {
        var request = authorized("magic", method: "POST")
        request.timeoutInterval = 120
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = try JSONEncoder().encode(["kind": kind.rawValue, "prompt": prompt])
        let reply = try await mediaReply(request, body: body)
        guard let media = reply.media else { throw RadugaError.network }
        return (media, reply.left)
    }

    func image(_ key: String) async -> UIImage? {
        if let cached = cache.object(forKey: key as NSString) { return cached }
        guard let (data, response) = try? await URLSession.shared.data(for: authorized("media/\(key)")),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let image = UIImage(data: data)
        else { return nil }
        cache.setObject(image, forKey: key as NSString)
        return image
    }
}
