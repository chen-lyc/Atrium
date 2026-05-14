package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type BenchClient struct {
	ID       int
	Username string
	Password string

	UserID uint64
	Cookie string

	conn        *websocket.Conn
	cfg         *Config
	stopCh      chan struct{}
	connectTime time.Duration

	mu          sync.Mutex
	sendTS      map[int]time.Time
	recvRecords []RecvRecord
}

func NewBenchClient(id int, cfg *Config) *BenchClient {
	return &BenchClient{
		ID:       id,
		Username: fmt.Sprintf("user_%d", id+cfg.StartID),
		Password: cfg.Password,
		cfg:      cfg,
		stopCh:   make(chan struct{}),
		sendTS:   make(map[int]time.Time),
	}
}

func (c *BenchClient) Login() error {
	form := url.Values{}
	form.Set("username", c.Username)
	form.Set("password", c.Password)

	req, err := http.NewRequest("POST", c.cfg.BaseURL+"/api/login", strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("login request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("login: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("login failed: status=%d body=%s", resp.StatusCode, string(body))
	}

	for _, ck := range resp.Cookies() {
		if ck.Name == "session_id" {
			c.Cookie = ck.Value
		}
	}
	if c.Cookie == "" {
		return fmt.Errorf("login: no session_id cookie")
	}

	meReq, _ := http.NewRequest("GET", c.cfg.BaseURL+"/api/me", nil)
	meReq.Header.Set("Cookie", fmt.Sprintf("session_id=%s", c.Cookie))
	meResp, err := http.DefaultClient.Do(meReq)
	if err != nil {
		return fmt.Errorf("/api/me: %w", err)
	}
	defer meResp.Body.Close()

	var meData struct {
		UserID json.Number `json:"user_id"`
	}
	json.NewDecoder(meResp.Body).Decode(&meData)
	c.UserID, _ = parseUint64(meData.UserID)
	if c.UserID == 0 {
		return fmt.Errorf("/api/me: could not parse user_id")
	}
	return nil
}

func (c *BenchClient) Connect() (time.Duration, error) {
	wsURL := strings.Replace(c.cfg.BaseURL, "http://", "ws://", 1)
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL += "/chat"

	header := http.Header{}
	header.Set("Cookie", fmt.Sprintf("session_id=%s", c.Cookie))

	start := time.Now()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	elapsed := time.Since(start)
	if err != nil {
		return elapsed, fmt.Errorf("websocket dial: %w", err)
	}
	c.conn = conn
	return elapsed, nil
}

func (c *BenchClient) Run(startCh <-chan struct{}, totalMsgs int) {
	var wg sync.WaitGroup
	wg.Add(2)

	go c.sendLoop(startCh, totalMsgs, &wg)
	go c.recvLoop(&wg)

	wg.Wait()
}

func (c *BenchClient) sendLoop(startCh <-chan struct{}, totalMsgs int, wg *sync.WaitGroup) {
	defer wg.Done()
	<-startCh

	time.Sleep(time.Duration(rand.Intn(1000)) * time.Millisecond)

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for seq := 0; seq < totalMsgs; seq++ {
		select {
		case <-c.stopCh:
			return
		default:
		}

		padding := randomString(20 + rand.Intn(181))
		content := fmt.Sprintf("client_%d_seq_%d_%s", c.ID, seq, padding)
		clientMsgID := fmt.Sprintf("client_%d_seq_%d", c.ID, seq)

		msg := clientMsg{
			Type: 0,
			Data: clientMsgData{
				RoomID:           c.cfg.RoomID,
				ConversationID:   c.cfg.ConversationID,
				Type:             1,
				Content:          content,
				ClientMessageID:  clientMsgID,
			},
		}

		c.mu.Lock()
		c.sendTS[seq] = time.Now()
		c.mu.Unlock()

		if err := c.conn.WriteJSON(msg); err != nil {
			return
		}

		<-ticker.C
	}
}

func (c *BenchClient) recvLoop(wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case <-c.stopCh:
			return
		default:
		}

		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}

		var msg serverMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if msg.Type != 0 {
			continue
		}

		senderID, ok := userIDToClientID[msg.Data.UserID]
		if !ok {
			continue
		}
		seq := parseSeq(msg.Data.Content)

		c.mu.Lock()
		c.recvRecords = append(c.recvRecords, RecvRecord{
			SenderID:   senderID,
			Seq:        seq,
			RecvTS:     time.Now(),
			SendTimeMS: msg.Data.SendTimeMS,
		})
		c.mu.Unlock()
	}
}

func (c *BenchClient) Close() {
	if c.conn != nil {
		c.conn.Close()
	}
}

type clientMsg struct {
	Type int           `json:"type"`
	Data clientMsgData `json:"data"`
}

type clientMsgData struct {
	RoomID           uint64 `json:"room_id"`
	ConversationID   uint64 `json:"conversation_id"`
	Type             int    `json:"type"`
	Content          string `json:"content"`
	ClientMessageID  string `json:"client_message_id"`
}

type serverMsg struct {
	Type int          `json:"type"`
	Data serverMsgData `json:"data"`
}

type serverMsgData struct {
	UserID    uint64 `json:"user_id"`
	Content   string `json:"content"`
	SendTimeMS int64  `json:"send_time_ms"`
}
