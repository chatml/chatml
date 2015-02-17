package memoize

import (
	"fmt"
	"testing"
	"time"
)

type FakeT struct {
	Msg     string
	Counter int
}

func (t *FakeT) method_string() string {
	t.Msg = "return string"
	t.Counter += 1
	return t.Msg
}
func (t *FakeT) method_int() int {
	t.Msg = "return integer"
	t.Counter += 1
	return t.Counter
}
func (t *FakeT) method_multi() (int, string) {
	t.Msg = "return integer and string, memoize string"
	t.Counter += 1
	return t.Counter, t.Msg
}

var f1_counter = 0

func func1(arg1 int, arg2 string) FakeT {
	t := FakeT{
		Msg:     "return struct",
		Counter: arg1,
	}
	f1_counter += 1
	return t
}

var f2_counter = 0

func func2() string {
	f2_counter += 1
	return "normal function"
}

func Test_Memoize_1(t *testing.T) {
	fmt.Println("Test function")
	// test function
	func1(0, "")
	obj2_1 := Memoize("func1", func() interface{} {
		memo := func1(1, "") // call
		return memo
	}, 60).(FakeT)
	obj2_2 := Memoize("func1", func() interface{} {
		memo := func1(2, "") // not call
		return memo
	}, 60).(FakeT)
	obj2_3 := Memoize("func1", func() interface{} {
		memo := func1(3, "") // not call
		return memo
	}, 60).(FakeT)
	obj2_4 := Memoize("func1", func() interface{} {
		memo := func1(4, "") // not call
		return memo
	}, 60).(FakeT)
	// memoized counter = 1
	if !(obj2_4.Counter == 1 && obj2_3.Counter == 1 && obj2_2.Counter == 1 && obj2_1.Counter == 1 && f1_counter == 2) {
		t.Errorf("test func1 failed!")
	}
}

func Test_Memoize_2(t *testing.T) {
	fmt.Println("Test function")
	// test function
	func2()
	s1 := Memoize("func2", func() interface{} {
		memo := func2()
		return memo
	}, 60).(string)
	s2 := Memoize("func2", func() interface{} {
		memo := func2()
		memo = "not here"
		return memo
	}, 60)
	fmt.Println(s1, "<=>", s2)
	if s2 != "normal function" && s1 != s2 && f2_counter != 2 {
		t.Errorf("test func2 failed!")
	}

}

// test methods
func Test_Memoize_3(t *testing.T) {
	fmt.Println("Test method")
	obj1 := FakeT{Msg: "", Counter: 0}
	obj1_1 := Memoize("method_string", func() interface{} {
		memo := obj1.method_string() // call, counter = 1
		return memo
	}, 60).(string)
	obj1_2 := Memoize("method_string", func() interface{} {
		memo := obj1.method_string() // not call
		return memo
	}, 60).(string)
	if !(obj1.Counter == 1 && obj1_2 == obj1_1 && obj1_1 == "return string") {
		t.Errorf("test method_string failed!")
	}

	obj2_1 := Memoize("method_int", func() interface{} {
		memo := obj1.method_int() // call, counter = 2
		return memo
	}, 60)
	obj2_2 := Memoize("method_int", func() interface{} {
		memo := obj1.method_int() // not call
		return memo
	}, 60)
	if !(obj1.Counter == 2 && obj2_1 == obj2_2 && obj2_2 == obj1.Counter) {
		t.Errorf("test method_int failed!")
	}

	obj3_1 := Memoize("method_multi", func() interface{} {
		_, memo := obj1.method_multi() // call, memoize the string
		return memo
	}, 60)
	obj3_2 := Memoize("method_multi", func() interface{} {
		_, memo := obj1.method_multi() // not call
		return memo
	}, 60)
	if !(obj1.Counter == 3 && obj3_2 == obj3_1 && obj3_2 == "return integer and string, memoize string") {
		t.Errorf("test method_multi failed!")
	}
}

func Test_Memoize_4(t *testing.T) {
	fmt.Println("Test timeout")
	// reset
	f2_counter = 0
	UnMemoize("func2")
	for i := 0; i < 5; i++ {
		Memoize("func2", func() interface{} {
			return func2() // call every time
		}, 0)
	}
	fmt.Println(f2_counter)
	if f2_counter != 5 {
		t.Errorf("test timeout = 0 failed!")
	}

	// test not timeout
	res1 := Memoize("func2", func() interface{} {
		return func2()
	}, 3)
	res2 := Memoize("func2", func() interface{} {
		return "not here"
	}, 3)
	if res1 != res2 { // should be original value
		t.Errorf("test not timeout failed!")
	}

	// test timeout
	time.Sleep(3 * time.Second)
	res3 := Memoize("func2", func() interface{} {
		return "new value"
	}, 3)
	fmt.Println(res3)
	if res3 != "new value" {
		t.Errorf("test reached timeout failed!")
	}
}
