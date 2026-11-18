#include <stdlib.h>

extern int __VERIFIER_nondet_int(void);

struct node {
    struct node *next;
    int data;
};

struct node *create(void)
{
    struct node *head = NULL;
    while (__VERIFIER_nondet_int()) {
        struct node *n = malloc(sizeof *n);
        if (!n)
            abort();
        n->next = head;
        n->data = 0;
        head = n;
    }
    return head;
}

struct node *reverse(struct node *p)
{
    struct node *prev = NULL;
    while (p) {
        p->next = prev;
        prev = p;
        p = p->next;
    }
    return prev;
}

void destroy(struct node *p)
{
    while (p) {
        struct node *next = p->next;
        free(p);
        p = next;
    }
}

int main(void)
{
    destroy(reverse(create()));
    return 0;
}
