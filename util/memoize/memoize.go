package memoize

import (
	"sync"
	"time"
)

type memo struct {
	Timeout time.Time
	Result  interface{}
}

type MemoPool struct {
	Pool  map[string]*memo
	mutex *sync.RWMutex
}

var mp *MemoPool

func init() {
	var m = map[string]*memo{}
	mp = &MemoPool{Pool: m, mutex: new(sync.RWMutex)}
}

// memorize result return from caller() block, timeout in N seconds
func Memoize(key string, caller func() interface{}, timeout uint) interface{} {
	if timeout == 0 {
		// do not memoize
		return caller()
	}
	mp.mutex.RLock()
	memoized := mp.Pool[key]
	mp.mutex.RUnlock()
	// reached timeout or not memoized
	if memoized == nil || memoized.Timeout.Before(time.Now()) {
		result := caller()
		if result != nil {
			duration := time.Duration(timeout) * time.Second
			mp.mutex.Lock()
			mp.Pool[key] = &memo{
				Timeout: time.Now().Add(duration),
				Result:  result,
			}
			mp.mutex.Unlock()
		}
		return result
	}
	return memoized.Result
}

func UnMemoize(key string) {
	delete(mp.Pool, key)
}

func UnMemoizeAll() {
	for key, _ := range mp.Pool {
		delete(mp.Pool, key)
	}
}
