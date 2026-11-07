--------------------------- MODULE TapCart ---------------------------
EXTENDS Naturals, FiniteSets, Sequences, TLC
CONSTANTS MaxSteps, Variant
Sessions == {"A", "B"}
Orders == {"A1", "A2", "B1"}
OrderOwner(o) == IF o = "B1" THEN "B" ELSE "A"
None == "NONE"
VARIABLES state, owner, rid, version, epoch, expired, protection,
          binding, orders, charges, processed, sales, used, observed, steps, action, actor
vars == <<state,owner,rid,version,epoch,expired,protection,binding,orders,
          charges,processed,sales,used,observed,steps,action,actor>>
EmptyOrder == [status |-> "NEW", rid |-> 0, version |-> 0, epoch |-> 0]
Init == /\ state = "AVAILABLE" /\ owner = None /\ rid = 0 /\ version = 0 /\ epoch = 0
        /\ expired = FALSE /\ protection = FALSE /\ binding = None
        /\ orders = [o \in Orders |-> EmptyOrder] /\ charges = [o \in Orders |-> 0]
        /\ processed = {} /\ sales = <<>> /\ used = {} /\ observed = {0}
        /\ steps = 0 /\ action = "Init" /\ actor = None
Tick == /\ steps < MaxSteps /\ state = "RESERVED" /\ ~expired
        /\ expired' = TRUE /\ protection' = FALSE /\ steps' = steps+1 /\ action' = "Timeout" /\ actor' = None
        /\ UNCHANGED <<state,owner,rid,version,epoch,binding,orders,charges,processed,sales,used,observed>>
Reserve(s,r,v) == /\ steps < MaxSteps /\ r \in {1,2} \ used /\ v \in observed
        /\ (state = "AVAILABLE" \/ Variant = "NoAvailability")
        /\ (v = version \/ Variant = "NoVersion")
        /\ state' = "RESERVED" /\ owner' = s /\ rid' = r /\ version' = version+1
        /\ expired' = FALSE /\ protection' = FALSE /\ binding' = None
        /\ used' = used \cup {r} /\ observed' = observed \cup {version+1}
        /\ steps' = steps+1 /\ action' = "Reserve" /\ actor' = s
        /\ UNCHANGED <<epoch,orders,charges,processed,sales>>
Free(s,v,kind) == /\ steps < MaxSteps /\ state = "RESERVED" /\ v \in observed
        /\ (kind = "Expire" => expired) /\ (kind = "Release" => (s = owner \/ Variant = "NoOwner"))
        /\ (~protection \/ Variant = "NoProtection") /\ (v = version \/ Variant = "NoVersion")
        /\ state' = "AVAILABLE" /\ owner' = None /\ rid' = 0 /\ version' = version+1
        /\ binding' = None /\ protection' = FALSE /\ expired' = FALSE
        /\ observed' = observed \cup {version+1} /\ steps' = steps+1 /\ action' = kind /\ actor' = s
        /\ UNCHANGED <<epoch,orders,charges,processed,sales,used>>
Checkout(o,v) == /\ steps < MaxSteps /\ state = "RESERVED" /\ ~expired
        /\ owner = OrderOwner(o) /\ orders[o].status = "NEW" /\ v \in observed
        /\ (~protection \/ Variant = "NoRebinding") /\ (v = version \/ Variant = "NoVersion")
        /\ binding' = o /\ protection' = TRUE /\ version' = version+1
        /\ orders' = [orders EXCEPT ![o] = [status |-> "PENDING", rid |-> rid, version |-> version+1, epoch |-> epoch]]
        /\ observed' = observed \cup {version+1} /\ steps' = steps+1 /\ action' = "Checkout" /\ actor' = OrderOwner(o)
        /\ UNCHANGED <<state,owner,rid,epoch,expired,charges,processed,sales,used>>
Charge(o) == /\ steps < MaxSteps /\ orders[o].status = "PENDING"
        /\ (charges[o] = 0 \/ (Variant = "NoChargeIdempotency" /\ charges[o] < 2))
        /\ charges' = [charges EXCEPT ![o] = @+1]
        /\ steps' = steps+1 /\ action' = "Charge" /\ actor' = OrderOwner(o)
        /\ UNCHANGED <<state,owner,rid,version,epoch,expired,protection,binding,orders,processed,sales,used,observed>>
Callback(o) == /\ steps < MaxSteps /\ charges[o] > 0 /\ o \notin processed
        /\ processed' = processed \cup {o} /\ orders' = [orders EXCEPT ![o].status = "PAID"]
        /\ steps' = steps+1 /\ action' = "Callback" /\ actor' = None
        /\ UNCHANGED <<state,owner,rid,version,epoch,expired,protection,binding,charges,sales,used,observed>>
Finalize(o) == /\ steps < MaxSteps /\ orders[o].status = "PAID"
        /\ (IF state = "RESERVED" /\ rid = orders[o].rid /\ owner = OrderOwner(o)
                  /\ (binding = o \/ Variant = "NoFinalBinding") /\ version = orders[o].version /\ epoch = orders[o].epoch
           THEN /\ state' = "SOLD" /\ owner' = None /\ rid' = 0 /\ binding' = None /\ protection' = FALSE
                /\ version' = version+1 /\ expired' = FALSE /\ observed' = observed \cup {version+1}
                /\ sales' = Append(sales, [order |-> o, epoch |-> epoch])
                /\ orders' = [orders EXCEPT ![o].status = "COMPLETED"]
           ELSE /\ orders' = [orders EXCEPT ![o].status = "REFUND_PENDING"]
                /\ UNCHANGED <<state,owner,rid,binding,protection,version,expired,observed,sales>>)
        /\ steps' = steps+1 /\ action' = "Finalize" /\ actor' = None
        /\ UNCHANGED <<epoch,charges,processed,used>>
PaymentFailure(o) == /\ steps < MaxSteps /\ orders[o].status = "PENDING"
        /\ orders' = [orders EXCEPT ![o].status = "FAILED"]
        /\ (IF state = "RESERVED" /\ binding = o /\ version = orders[o].version
             THEN /\ state' = "AVAILABLE" /\ owner' = None /\ rid' = 0 /\ binding' = None
                  /\ protection' = FALSE /\ expired' = FALSE /\ version' = version+1
                  /\ observed' = observed \cup {version+1}
             ELSE UNCHANGED <<state,owner,rid,binding,protection,expired,version,observed>>)
        /\ steps' = steps+1 /\ action' = "PaymentFailure" /\ actor' = None
        /\ UNCHANGED <<epoch,charges,processed,sales,used>>
Refund(o) == /\ steps < MaxSteps /\ orders[o].status = "REFUND_PENDING"
        /\ orders' = [orders EXCEPT ![o].status = "REFUNDED"]
        /\ steps' = steps+1 /\ action' = "Refund" /\ actor' = None
        /\ UNCHANGED <<state,owner,rid,version,epoch,expired,protection,binding,charges,processed,sales,used,observed>>
Return == /\ steps < MaxSteps /\ state = "SOLD" /\ epoch < 1
        /\ state' = "AVAILABLE" /\ epoch' = epoch+1 /\ version' = version+1
        /\ observed' = observed \cup {version+1} /\ steps' = steps+1 /\ action' = "Return" /\ actor' = None
        /\ UNCHANGED <<owner,rid,expired,protection,binding,orders,charges,processed,sales,used>>
Duplicate == /\ steps < MaxSteps /\ steps' = steps+1 /\ action' = "DuplicateOrLostResponse" /\ actor' = None
        /\ UNCHANGED <<state,owner,rid,version,epoch,expired,protection,binding,orders,charges,processed,sales,used,observed>>
Next == Tick \/ (\E s \in Sessions,r \in {1,2},v \in observed : Reserve(s,r,v))
        \/ (\E s \in Sessions,v \in observed,k \in {"Release","Expire"}: Free(s,v,k))
        \/ (\E o \in Orders,v \in observed: Checkout(o,v))
        \/ (\E o \in Orders: Charge(o) \/ Callback(o) \/ Finalize(o) \/ Refund(o) \/ PaymentFailure(o)) \/ Return \/ Duplicate
Spec == Init /\ [][Next]_vars
Structural == /\ state \in {"AVAILABLE","RESERVED","SOLD"}
              /\ (state = "RESERVED" <=> owner \in Sessions /\ rid \in {1,2})
              /\ (state # "RESERVED" => owner = None /\ rid = 0 /\ ~protection /\ binding = None)
              /\ (protection => binding \in Orders /\ state = "RESERVED")
UniqueSale == \A i,j \in 1..Len(sales): sales[i].epoch = sales[j].epoch => i=j
PaymentBeforeSale == \A i \in 1..Len(sales): sales[i].order \in processed
SingleCharge == \A o \in Orders: charges[o] <= 1
OrderConsistency == \A o \in Orders: /\ (orders[o].status = "COMPLETED" => \E i \in 1..Len(sales): sales[i].order=o)
                                                /\ (orders[o].status = "REFUNDED" => o \in processed)
ReservationExclusivity == [][((state="RESERVED" /\ state'="RESERVED") => rid'=rid)]_vars
OwnerRelease == [][(action'="Release" => actor'=owner)]_vars
VersionMonotonic == [][(version'>=version)]_vars
ProtectionIntegrity == [][(protection => (action' \in {"Timeout","Finalize","PaymentFailure"} \/ (state'="RESERVED" /\ rid'=rid /\ binding'=binding)))]_vars
=============================================================================
