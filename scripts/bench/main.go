package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"os"
	"strconv"
	"sync"
	"time"
)

type Config struct {
	BaseURL        string
	RoomID         uint64
	ConversationID uint64
	NumClients     int
	Duration       time.Duration
	DrainTime      time.Duration
	StartID        int
	Password       string
}

var userIDToClientID = map[uint64]int{}

func main() {
	cfg := parseFlags()

	rand.Seed(time.Now().UnixNano())

	log.Printf("Starting %d clients, target: %s, room=%d conv=%d", cfg.NumClients, cfg.BaseURL, cfg.RoomID, cfg.ConversationID)

	clients := make([]*BenchClient, cfg.NumClients)
	for i := 0; i < cfg.NumClients; i++ {
		clients[i] = NewBenchClient(i, cfg)
	}

	// Phase 1: login all clients concurrently
	log.Printf("Phase 1: Login (%d clients) ...", cfg.NumClients)
	var loginWg sync.WaitGroup
	loginErrs := make(chan error, cfg.NumClients)
	for _, c := range clients {
		loginWg.Add(1)
		go func(c *BenchClient) {
			defer loginWg.Done()
			if err := c.Login(); err != nil {
				loginErrs <- fmt.Errorf("%s: %w", c.Username, err)
			}
		}(c)
	}
	loginWg.Wait()
	close(loginErrs)
	if errs := drainErrs(loginErrs); len(errs) > 0 {
		for _, e := range errs {
			log.Println(e)
		}
		log.Fatalf("%d clients failed login", len(errs))
	}
	log.Printf("✓ Login: all %d clients authenticated", cfg.NumClients)

	// Build user_id → clientID mapping
	for _, c := range clients {
		userIDToClientID[c.UserID] = c.ID
	}
	log.Printf("Login complete, %d user_id mappings built", len(userIDToClientID))

	// Phase 2: connect WebSocket all concurrently
	log.Printf("Phase 2: WebSocket connect (%d clients) ...", cfg.NumClients)
	var connWg sync.WaitGroup
	connectTimes := make([]time.Duration, cfg.NumClients)
	connErrs := make(chan error, cfg.NumClients)
	for i, c := range clients {
		connWg.Add(1)
		go func(idx int, c *BenchClient) {
			defer connWg.Done()
			elapsed, err := c.Connect()
			connectTimes[idx] = elapsed
			if err != nil {
				connErrs <- fmt.Errorf("%s: %w", c.Username, err)
			}
		}(i, c)
	}
	connWg.Wait()
	close(connErrs)
	if errs := drainErrs(connErrs); len(errs) > 0 {
		for _, e := range errs {
			log.Println(e)
		}
		log.Fatalf("%d clients failed connect", len(errs))
	}
	log.Printf("✓ Connect: all %d WebSocket connections established", cfg.NumClients)

	// Store connect times for report
	for i, c := range clients {
		c.connectTime = connectTimes[i]
	}

	// Phase 3: synchronized start
	log.Printf("Phase 3: Benchmark — %s at 1 msg/s/client, then %s drain",
		cfg.Duration, cfg.DrainTime)
	startCh := make(chan struct{})
	totalMsgs := int(cfg.Duration.Seconds())

	var runWg sync.WaitGroup
	for _, c := range clients {
		runWg.Add(1)
		go func(c *BenchClient) {
			defer runWg.Done()
			c.Run(startCh, totalMsgs)
		}(c)
	}

	close(startCh)
	log.Printf("✓ Benchmark started: %d clients sending 1 msg/s for %s",
		cfg.NumClients, cfg.Duration)

	time.Sleep(cfg.Duration + cfg.DrainTime)

	log.Println("Stopping all clients ...")
	for _, c := range clients {
		close(c.stopCh)
		c.Close()
	}
	runWg.Wait()
	log.Printf("✓ All %d clients stopped", cfg.NumClients)

	// Build global sendTS map for oracle
	allSendTS := make(map[int]map[int]time.Time, cfg.NumClients)
	for _, c := range clients {
		c.mu.Lock()
		ts := make(map[int]time.Time, len(c.sendTS))
		for k, v := range c.sendTS {
			ts[k] = v
		}
		c.mu.Unlock()
		allSendTS[c.ID] = ts
	}

	// Phase 4: oracle
	log.Println("Phase 4: Oracle verification ...")
	report := RunOracle(cfg, clients, allSendTS)
	PrintReport(report, cfg.NumClients)
}

func parseFlags() *Config {
	cfg := &Config{}

	flag.StringVar(&cfg.BaseURL, "url", "http://localhost:8080", "Server base URL")
	flag.Uint64Var(&cfg.RoomID, "room", 0, "Room ID")
	flag.Uint64Var(&cfg.ConversationID, "conv", 0, "Conversation ID")
	flag.IntVar(&cfg.NumClients, "clients", 100, "Number of concurrent clients")
	flag.DurationVar(&cfg.Duration, "duration", 30*time.Second, "Send duration")
	flag.DurationVar(&cfg.DrainTime, "drain", 3*time.Second, "Drain time after send stops")
	flag.IntVar(&cfg.StartID, "start-id", 0, "Starting client ID (matches seed user_<start-id>)")
	flag.StringVar(&cfg.Password, "password", "bench123", "Password for test users")
	flag.Parse()

	if cfg.RoomID == 0 || cfg.ConversationID == 0 {
		fmt.Fprintf(os.Stderr, "Usage: bench -room <id> -conv <id> [flags]\n")
		flag.PrintDefaults()
		os.Exit(1)
	}
	return cfg
}

func drainErrs(ch <-chan error) []error {
	var errs []error
	for e := range ch {
		errs = append(errs, e)
	}
	return errs
}

func parseUint64(n json.Number) (uint64, error) {
	return strconv.ParseUint(string(n), 10, 64)
}

var letterRunes = []rune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")

func randomString(n int) string {
	b := make([]rune, n)
	for i := range b {
		b[i] = letterRunes[rand.Intn(len(letterRunes))]
	}
	return string(b)
}
