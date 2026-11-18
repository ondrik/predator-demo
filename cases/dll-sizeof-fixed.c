#include <stdlib.h>

extern int __VERIFIER_nondet_int(void);

struct node {
    struct node *next;
    struct node *prev;
    int data;
};

struct node *append(struct node *tail, int data)
{
    struct node *n = malloc(sizeof(*n));
    if (!n)
        abort();
    n->next = NULL;
    n->prev = tail;
    n->data = data;
    if (tail)
        tail->next = n;
    return n;
}

int main(void)
{
    struct node *tail = NULL;
    while (__VERIFIER_nondet_int())
        tail = append(tail, 42);

    while (tail) {
        struct node *prev = tail->prev;
        free(tail);
        tail = prev;
    }
    return 0;
}
