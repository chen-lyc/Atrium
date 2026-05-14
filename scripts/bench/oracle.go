package main

import (
	"sort"
	"strconv"
	"strings"
	"time"
)

type RecvRecord struct {
	SenderID   int       `json:"sender_id"`
	Seq        int       `json:"seq"`
	RecvTS     time.Time `json:"recv_ts"`
	SendTimeMS int64     `json:"send_time_ms"`
}

type LatencyStats struct {
	Samples int
	P50     time.Duration
	P90     time.Duration
	P99     time.Duration
}

type OracleReport struct {
	ConnectTimes []time.Duration

	ExpectedReceives int
	ActualReceives   int
	Lost             int
	Duplicated       int

	Seg1  LatencyStats
	Seg2  LatencyStats
	Total LatencyStats

	Seg1Expected       int
	Seg1Found          int
	Seg1DroppedBounds  int
}

func RunOracle(cfg *Config, clients []*BenchClient, allSendTS map[int]map[int]time.Time) *OracleReport {
	r := &OracleReport{}

	msgsPerClient := int(cfg.Duration.Seconds())
	totalSenders := cfg.NumClients
	r.ExpectedReceives = totalSenders * msgsPerClient * totalSenders
	r.Seg1Expected = totalSenders * msgsPerClient

	keyCounts := map[recvKey]int{}
	var seg1Durations []time.Duration
	var seg2Durations []time.Duration
	var totalDurations []time.Duration

	for _, c := range clients {
		c.mu.Lock()
		records := make([]RecvRecord, len(c.recvRecords))
		copy(records, c.recvRecords)
		c.mu.Unlock()

		for _, rec := range records {
			keyCounts[recvKey{rec.SenderID, rec.Seq}]++

			// Total latency: uses sender's sendTS
			if senderTS, ok := allSendTS[rec.SenderID]; ok {
				if sendTS, ok := senderTS[rec.Seq]; ok {
					total := rec.RecvTS.Sub(sendTS)
					if total > -2*time.Second && total < 10*time.Second {
						totalDurations = append(totalDurations, total)
					}

					// Segment 1: only for self-receive
					if rec.SenderID == c.ID {
						r.Seg1Found++
						sendTime := time.UnixMilli(rec.SendTimeMS)
						seg1 := sendTime.Sub(sendTS)
						if seg1 > -2*time.Second && seg1 < 10*time.Second {
							seg1Durations = append(seg1Durations, seg1)
						} else {
							r.Seg1DroppedBounds++
						}
					}
				}
			}

			// Segment 2: DB write → receive
			if rec.SendTimeMS > 0 {
				sendTime := time.UnixMilli(rec.SendTimeMS)
				seg2 := rec.RecvTS.Sub(sendTime)
				if seg2 > -2*time.Second && seg2 < 10*time.Second {
					seg2Durations = append(seg2Durations, seg2)
				}
			}
		}
	}

	for senderID := 0; senderID < totalSenders; senderID++ {
		for seq := 0; seq < msgsPerClient; seq++ {
			c := keyCounts[recvKey{senderID, seq}]
			if c < totalSenders {
				r.Lost += totalSenders - c
			}
			if c > totalSenders {
				r.Duplicated += c - totalSenders
			}
		}
	}

	r.ActualReceives = 0
	for _, c := range keyCounts {
		r.ActualReceives += c
	}

	r.Seg1 = computeLatencyStats(seg1Durations)
	r.Seg2 = computeLatencyStats(seg2Durations)
	r.Total = computeLatencyStats(totalDurations)

	for _, c := range clients {
		c.mu.Lock()
		r.ConnectTimes = append(r.ConnectTimes, c.connectTime)
		c.mu.Unlock()
	}

	return r
}

type recvKey struct {
	SenderID int
	Seq      int
}

func computeLatencyStats(durations []time.Duration) LatencyStats {
	if len(durations) == 0 {
		return LatencyStats{}
	}
	sort.Slice(durations, func(i, j int) bool {
		return durations[i] < durations[j]
	})
	n := len(durations)
	return LatencyStats{
		Samples: n,
		P50:     durations[n*50/100],
		P90:     durations[n*90/100],
		P99:     durations[n*99/100],
	}
}

func parseSeq(content string) int {
	idx := strings.Index(content, "_seq_")
	if idx < 0 {
		return -1
	}
	rest := content[idx+5:]
	end := 0
	for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
		end++
	}
	n, _ := strconv.Atoi(rest[:end])
	return n
}
